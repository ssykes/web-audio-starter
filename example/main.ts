/**
 * The working example: a four-note pad, each note a unison stack, through the
 * effect chain the registry declares.
 *
 * Small on purpose. It touches every module in the library and demonstrates the
 * two habits the rest of the code assumes: a context is created inside a user
 * gesture, and a continuous parameter is slewed to its target rather than
 * assigned.
 */

import {
  buildEffectChain,
  clampUnison,
  effectChainFingerprint,
  follow,
  MAX_UNISON_TRIGGERED,
  noteToFrequency,
  sanitizeAmplitude,
  unisonDetuneCents,
  type EffectChain,
  type EffectSlot,
} from "../src/index.ts";

/** A minor cluster, low enough that the detune compensation is audible. */
const CHORD = [45, 48, 52, 57];

let ctx: AudioContext | null = null;
let chain: EffectChain | null = null;
let master: GainNode | null = null;
let oscillators: OscillatorNode[] = [];

/** The slots the chain is built from. Edited in place, so a control has one target. */
let slots: EffectSlot[] = [
  { id: "lp", type: "lowpass", enabled: true, params: { cutoff: 1800, q: 2 } },
  { id: "w", type: "width", enabled: true, params: { width: 1.4 } },
  { id: "rv", type: "convolver", enabled: true, params: { mix: 0.3, seconds: 2.5 } },
];

/** What the built chain was made from, so a rebuild is a comparison and not a guess. */
let builtFingerprint = "";

let unison = 3;
let detuneCents = 12;
let amplitude = 0.7;

/**
 * Rebuild the oscillator stack.
 *
 * Structure, not parameters: a different unison count means a different number
 * of nodes, so the old ones are stopped and disconnected rather than reused.
 */
function buildPad(): void {
  if (ctx === null || chain === null || master === null) return;

  for (const osc of oscillators) {
    try {
      osc.stop();
    } catch {
      // already stopped
    }
    osc.disconnect();
  }
  oscillators = [];

  const n = clampUnison(unison, MAX_UNISON_TRIGGERED);
  const now = ctx.currentTime;
  for (const note of CHORD) {
    const frequency = noteToFrequency(note);
    for (let i = 0; i < n; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = frequency;
      // Compensated per note, so every chord member beats at the same rate. One
      // spread for the whole stack wobbles in the bass and flutters in the treble.
      osc.detune.value = unisonDetuneCents(frequency, detuneCents, i, n);
      // One nth of the voice per oscillator, so adding layers thickens the sound
      // without making it louder.
      gain.gain.value = 1 / n;
      osc.connect(gain);
      gain.connect(chain.input);
      osc.start(now);
      oscillators.push(osc);
    }
  }

  follow(master.gain, sanitizeAmplitude(amplitude), now, 0.05);
}

/**
 * Rebuild the chain only when its structure changed.
 *
 * A convolver cannot be spliced into a running chain without a discontinuity, so
 * a structure change rebuilds and a parameter change slews. Comparing
 * fingerprints is what keeps a slider drag from rebuilding on every input event.
 */
function syncChain(): void {
  if (ctx === null || master === null) return;
  const fingerprint = effectChainFingerprint(slots);
  if (chain !== null && builtFingerprint === fingerprint) {
    chain.update(slots);
    return;
  }
  chain?.dispose();
  chain = buildEffectChain(ctx, slots);
  builtFingerprint = fingerprint;
  chain.output.connect(master);
  buildPad();
}

function start(): void {
  if (ctx !== null) return;
  // Inside the gesture, or the context starts suspended and nothing sounds.
  ctx = new AudioContext({ latencyHint: "interactive" });
  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  syncChain();
  follow(master.gain, sanitizeAmplitude(amplitude), ctx.currentTime, 0.2);
}

function stop(): void {
  if (ctx === null) return;
  const closing = ctx;
  for (const osc of oscillators) {
    try {
      osc.stop();
    } catch {
      // already stopped
    }
    osc.disconnect();
  }
  oscillators = [];
  chain?.dispose();
  chain = null;
  builtFingerprint = "";
  master?.disconnect();
  master = null;
  ctx = null;
  void closing.close();
}

/* ------------------------------- controls ------------------------------- */

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`no element #${id}`);
  return found as T;
};

function slider(
  id: string,
  out: string,
  format: (v: number) => string,
  onInput: (v: number) => void,
): void {
  const input = el<HTMLInputElement>(id);
  const shown = el<HTMLOutputElement>(out);
  const apply = () => {
    const v = Number(input.value);
    shown.value = format(v);
    onInput(v);
  };
  input.addEventListener("input", apply);
  apply();
}

slider("unison", "unisonOut", (v) => String(v), (v) => {
  unison = v;
  buildPad();
});
slider("detune", "detuneOut", (v) => v.toFixed(1), (v) => {
  detuneCents = v;
  buildPad();
});
slider("amp", "ampOut", (v) => v.toFixed(2), (v) => {
  amplitude = v;
  if (ctx !== null && master !== null) {
    follow(master.gain, sanitizeAmplitude(v), ctx.currentTime, 0.05);
  }
});
slider("cutoff", "cutoffOut", (v) => String(Math.round(v)), (v) => {
  slots[0].params.cutoff = v;
  syncChain();
});
slider("width", "widthOut", (v) => v.toFixed(2), (v) => {
  slots[1].params.width = v;
  syncChain();
});
slider("mix", "mixOut", (v) => v.toFixed(2), (v) => {
  slots[2].params.mix = v;
  syncChain();
});

const toggle = el<HTMLButtonElement>("toggle");
toggle.addEventListener("click", () => {
  if (ctx === null) {
    start();
    toggle.textContent = "Stop";
  } else {
    stop();
    toggle.textContent = "Start";
  }
});
