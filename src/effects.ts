/**
 * An effect chain built from descriptors rather than from named cases.
 *
 * The registry declares what exists and what each parameter means; the builder
 * reads the declaration. Adding an effect type is therefore one entry, not an
 * edit to every surface that offers one — and a type the registry declares but
 * nothing implements degrades to a passthrough instead of breaking the chain.
 *
 * **Two rules this module obeys, because both failures are silent.**
 *
 * A mono source through a width matrix collapses to one channel. The folded
 * mid/side form reads the right input as silence, so unity width would pass only
 * the left channel — a half-level, one-sided voice that still appears to work.
 * The width stage up-mixes to dual mono first, and because its two coefficients
 * always sum to one, dual mono passes at unity for every width. That is the
 * honest reading of "width does nothing to a mono source" rather than an
 * accidental 6 dB loss.
 *
 * Every parameter is slewed, never assigned. A voice can sound for minutes while
 * a control moves under it, and a direct write is a click.
 *
 * Structure changes are not handled live. Updating slews the parameters of the
 * stages already built and ignores a mismatched list; callers compare
 * fingerprints and rebuild, because a convolver cannot be spliced into a running
 * chain without a discontinuity anyway.
 */

/** One number an effect exposes: its range, its step and how it is read. */
export interface ParamDescriptor {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Appended to the readout. Absent for a unitless number. */
  unit?: string;
  /** The control travels logarithmically, as frequency and time do. */
  log?: boolean;
}

export interface EffectTypeDescriptor {
  id: string;
  label: string;
  blurb: string;
  params: ParamDescriptor[];
}

/**
 * What can be inserted, and the range of each parameter on it.
 *
 * The ranges live here rather than in the controls that render them, so a
 * control cannot drift away from what the audio path accepts. One source of
 * truth is the only way a slider and a validator agree.
 */
export const EFFECT_TYPES: Record<string, EffectTypeDescriptor> = {
  lowpass: {
    id: "lowpass",
    label: "Lowpass filter",
    blurb: "Biquad lowpass. Resonance is the control a plain cutoff does not have.",
    params: [
      { key: "cutoff", label: "cutoff", min: 60, max: 16000, step: 1, unit: "Hz", log: true },
      { key: "q", label: "resonance Q", min: 0.1, max: 18, step: 0.1 },
    ],
  },
  convolver: {
    id: "convolver",
    label: "Reverb (convolver)",
    blurb: "Convolution against a generated impulse response. Cost scales per node.",
    params: [
      { key: "mix", label: "wet mix", min: 0, max: 1, step: 0.01 },
      { key: "seconds", label: "IR length", min: 0.2, max: 8, step: 0.1, unit: "s" },
    ],
  },
  width: {
    id: "width",
    label: "Stereo width",
    blurb: "Mid/side matrix. Needs a stereo source; does nothing on mono.",
    params: [{ key: "width", label: "width", min: 0, max: 2, step: 0.01 }],
  },
  tremolo: {
    id: "tremolo",
    label: "Tremolo",
    blurb: "Amplitude LFO. Shows that the registry is open-ended.",
    params: [
      { key: "rate", label: "rate", min: 0.05, max: 12, step: 0.05, unit: "Hz" },
      { key: "depth", label: "depth", min: 0, max: 1, step: 0.01 },
    ],
  },
};

/** One ordered, enableable effect instance. */
export interface EffectSlot {
  id: string;
  type: string;
  enabled: boolean;
  params: Record<string, number>;
}

/** Below this a slew is indistinguishable from a step. */
const MIN_SLEW = 0.005;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Mid/side coefficients for the folded width matrix.
 *
 * Pure and exported because it is the arithmetic that can silently halve a
 * voice: the two coefficients summing to one is what makes dual mono pass at
 * unity, and a width outside the range drives one of them negative — a
 * phase-inverted side rather than a failure, so it is clamped here.
 */
export function widthCoefficients(width: number): { a: number; b: number } {
  const w = clamp(Number.isFinite(width) ? width : 1, 0, 2);
  return { a: (1 + w) / 2, b: (1 - w) / 2 };
}

/**
 * Dry and wet levels for a parallel reverb send.
 *
 * Pure for the same reason: zero mix must be exactly dry, because a wet path
 * left open at zero still burns a convolution and still colours the tail.
 */
export function reverbMixLevels(mix: number): { dry: number; wet: number } {
  const m = clamp(Number.isFinite(mix) ? mix : 0, 0, 1);
  return { dry: 1 - m, wet: m };
}

/**
 * The slots that will actually be built, in order, as one comparable string.
 *
 * A caller rebuilds when this differs. Disabled slots are excluded because a
 * disabled effect is not built at all.
 */
export function effectChainFingerprint(slots: EffectSlot[]): string {
  return slots
    .filter((s) => s.enabled)
    .map((s) => `${s.id}:${s.type}`)
    .join("|");
}

/**
 * A decorrelated stereo impulse response: independent noise per channel,
 * decaying over its length.
 *
 * Two channels from one noise source would be mono-summed by the convolver and
 * the reverb would have no width of its own — which is inaudible as a defect and
 * very audible as a small room.
 */
export function impulseResponse(
  ctx: BaseAudioContext,
  seconds: number,
  decay = 2.5,
): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(clamp(seconds, 0.01, 30) * rate));
  const buffer = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return buffer;
}

/** Anything with an input, an output and a teardown. */
export interface AudioStage {
  input: AudioNode;
  output: AudioNode;
  dispose(): void;
}

export interface WidthStage extends AudioStage {
  setWidth(width: number, slewS?: number): void;
}

/**
 * The folded mid/side width matrix, mono-safe.
 *
 * The input up-mixes to dual mono, then four gains form the matrix into a
 * channel merger. Six nodes beyond the up-mix and only two distinct coefficient
 * values to automate, which is why width stays a parameter-rate control rather
 * than needing a worklet.
 */
export function createWidth(ctx: BaseAudioContext, width: number): WidthStage {
  const input = ctx.createGain();
  const upmix = ctx.createChannelMerger(2);
  input.connect(upmix, 0, 0);
  input.connect(upmix, 0, 1);

  const splitter = ctx.createChannelSplitter(2);
  upmix.connect(splitter);
  const merger = ctx.createChannelMerger(2);
  const ll = ctx.createGain();
  const lr = ctx.createGain();
  const rl = ctx.createGain();
  const rr = ctx.createGain();
  const { a, b } = widthCoefficients(width);
  ll.gain.value = a;
  lr.gain.value = b;
  rl.gain.value = b;
  rr.gain.value = a;
  splitter.connect(ll, 0);
  splitter.connect(lr, 1);
  splitter.connect(rl, 0);
  splitter.connect(rr, 1);
  // Each output channel is the diagonal coefficient times its own input plus
  // the off-diagonal coefficient times the other one.
  ll.connect(merger, 0, 0);
  lr.connect(merger, 0, 0);
  rl.connect(merger, 0, 1);
  rr.connect(merger, 0, 1);

  const output = ctx.createGain();
  merger.connect(output);

  const all = [input, upmix, splitter, ll, lr, rl, rr, merger, output];
  return {
    input,
    output,
    setWidth(next: number, slewS = 0.05) {
      const c = widthCoefficients(next);
      const t = ctx.currentTime;
      const k = Math.max(MIN_SLEW, slewS);
      ll.gain.setTargetAtTime(c.a, t, k);
      rr.gain.setTargetAtTime(c.a, t, k);
      lr.gain.setTargetAtTime(c.b, t, k);
      rl.gain.setTargetAtTime(c.b, t, k);
    },
    dispose() {
      for (const node of all) {
        try {
          node.disconnect();
        } catch {
          // already gone
        }
      }
    },
  };
}

export interface ReverbStage extends AudioStage {
  setMix(mix: number, slewS?: number): void;
  setSeconds(seconds: number): void;
}

/**
 * A parallel convolution send: dry to the output, and wet through the convolver
 * beside it.
 *
 * Parallel rather than serial so zero mix is bit-exact dry and the effect can be
 * dialled without the source ever passing through a node that is off. The same
 * shape serves a per-voice reverb and a shared one, because both are optional
 * and one implementation covers them.
 */
export function createReverbSend(
  ctx: BaseAudioContext,
  spec: { mix: number; seconds: number },
): ReverbStage {
  const input = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const convolver = ctx.createConvolver();
  const output = ctx.createGain();
  convolver.buffer = impulseResponse(ctx, spec.seconds);
  const levels = reverbMixLevels(spec.mix);
  dry.gain.value = levels.dry;
  wet.gain.value = levels.wet;
  input.connect(dry);
  dry.connect(output);
  input.connect(convolver);
  convolver.connect(wet);
  wet.connect(output);

  return {
    input,
    output,
    setMix(mix: number, slewS = 0.05) {
      const l = reverbMixLevels(mix);
      const t = ctx.currentTime;
      const k = Math.max(MIN_SLEW, slewS);
      dry.gain.setTargetAtTime(l.dry, t, k);
      wet.gain.setTargetAtTime(l.wet, t, k);
    },
    setSeconds(seconds: number) {
      // A new buffer is the only way to change an impulse response; the node
      // has no length parameter. It restarts the tail, so this is a click on a
      // moving voice — acceptable for a control being deliberately dragged.
      convolver.buffer = impulseResponse(ctx, seconds);
    },
    dispose() {
      for (const node of [input, dry, wet, convolver, output]) {
        try {
          node.disconnect();
        } catch {
          // already gone
        }
      }
      convolver.buffer = null;
    },
  };
}

interface BuiltStage extends AudioStage {
  slotId: string;
  type: string;
  set(params: Record<string, number>): void;
}

/** A slot the registry declares but nothing implements must not break the chain. */
function passthrough(ctx: BaseAudioContext): BuiltStage {
  const node = ctx.createGain();
  return {
    slotId: "",
    type: "",
    input: node,
    output: node,
    set() {},
    dispose() {
      try {
        node.disconnect();
      } catch {
        // already gone
      }
    },
  };
}

function buildStage(ctx: BaseAudioContext, slot: EffectSlot): BuiltStage {
  const param = (key: string, fallback: number): number => {
    const v = slot.params[key];
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
  };

  switch (slot.type) {
    case "lowpass": {
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = param("cutoff", 1800);
      filter.Q.value = param("q", 2);
      return {
        slotId: slot.id,
        type: slot.type,
        input: filter,
        output: filter,
        set(p) {
          const t = ctx.currentTime;
          if (typeof p.cutoff === "number") {
            filter.frequency.setTargetAtTime(clamp(p.cutoff, 20, 20_000), t, 0.02);
          }
          if (typeof p.q === "number") filter.Q.setTargetAtTime(clamp(p.q, 0.0001, 30), t, 0.02);
        },
        dispose() {
          try {
            filter.disconnect();
          } catch {
            // already gone
          }
        },
      };
    }

    case "convolver": {
      const reverb = createReverbSend(ctx, {
        mix: param("mix", 0.3),
        seconds: param("seconds", 2.5),
      });
      let seconds = param("seconds", 2.5);
      return {
        slotId: slot.id,
        type: slot.type,
        input: reverb.input,
        output: reverb.output,
        set(p) {
          if (typeof p.mix === "number") reverb.setMix(p.mix);
          if (typeof p.seconds === "number" && Math.abs(p.seconds - seconds) > 0.05) {
            seconds = p.seconds;
            reverb.setSeconds(p.seconds);
          }
        },
        dispose: () => reverb.dispose(),
      };
    }

    case "width": {
      const width = createWidth(ctx, param("width", 1));
      return {
        slotId: slot.id,
        type: slot.type,
        input: width.input,
        output: width.output,
        set(p) {
          if (typeof p.width === "number") width.setWidth(p.width);
        },
        dispose: () => width.dispose(),
      };
    }

    case "tremolo": {
      // The base gain sits below unity by half the depth and the LFO adds plus
      // or minus the same half, so the amplitude swings between one minus the
      // depth and one and never exceeds unity.
      const amp = ctx.createGain();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      const rate = param("rate", 4);
      const depth = clamp(param("depth", 0.5), 0, 1);
      amp.gain.value = 1 - depth / 2;
      lfoGain.gain.value = depth / 2;
      lfo.type = "sine";
      lfo.frequency.value = rate;
      lfo.connect(lfoGain);
      lfoGain.connect(amp.gain);
      lfo.start();
      return {
        slotId: slot.id,
        type: slot.type,
        input: amp,
        output: amp,
        set(p) {
          const t = ctx.currentTime;
          if (typeof p.rate === "number") {
            lfo.frequency.setTargetAtTime(clamp(p.rate, 0.01, 40), t, 0.02);
          }
          if (typeof p.depth === "number") {
            const d = clamp(p.depth, 0, 1);
            amp.gain.setTargetAtTime(1 - d / 2, t, 0.02);
            lfoGain.gain.setTargetAtTime(d / 2, t, 0.02);
          }
        },
        dispose() {
          try {
            lfo.stop();
          } catch {
            // already stopped
          }
          for (const node of [amp, lfo, lfoGain]) {
            try {
              node.disconnect();
            } catch {
              // already gone
            }
          }
        },
      };
    }

    default:
      return passthrough(ctx);
  }
}

export interface EffectChain extends AudioStage {
  /** Slew the parameters of the stages already built; ignores structure changes. */
  update(slots: EffectSlot[]): void;
}

/**
 * Build the enabled slots, in order, as one serial chain.
 *
 * The input and output are always real nodes even when nothing is enabled, so a
 * caller can wire the chain unconditionally and an empty list is a genuine
 * passthrough rather than a null to branch on.
 */
export function buildEffectChain(ctx: BaseAudioContext, slots: EffectSlot[]): EffectChain {
  const head = ctx.createGain();
  const tail = ctx.createGain();
  const stages: BuiltStage[] = [];
  let cursor: AudioNode = head;
  for (const slot of slots) {
    if (!slot.enabled) continue;
    const stage = buildStage(ctx, slot);
    stage.slotId = slot.id;
    stage.type = slot.type;
    cursor.connect(stage.input);
    cursor = stage.output;
    stages.push(stage);
  }
  cursor.connect(tail);

  return {
    input: head,
    output: tail,
    update(next: EffectSlot[]) {
      const enabled = next.filter((s) => s.enabled);
      // Matched positionally on type, because a chain rebuilt on a structure
      // change keeps the same order. A mismatch is ignored rather than applied
      // to the wrong node: writing a cutoff to a width gain is the kind of error
      // that is audible but unattributable.
      for (let i = 0; i < stages.length && i < enabled.length; i++) {
        if (stages[i].type !== enabled[i].type) continue;
        stages[i].set(enabled[i].params);
      }
    },
    dispose() {
      for (const stage of stages) stage.dispose();
      for (const node of [head, tail]) {
        try {
          node.disconnect();
        } catch {
          // already gone
        }
      }
    },
  };
}
