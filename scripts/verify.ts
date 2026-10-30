/**
 * Assertions for the pure half of the library.
 *
 * Runs in Node with no browser and no audio device, because the arithmetic that
 * decides pitch, spread, level and stereo width fails silently: a wrong number
 * is not an error, it is a different sound, and it plays perfectly happily. The
 * builders that need a context are exercised by the example instead.
 *
 * Run with `npm run verify`.
 */

import {
  computePeaks,
  clampUnison,
  DEFAULT_AMPLITUDE,
  DETUNE_REFERENCE_HZ,
  effectChainFingerprint,
  encodeWavMono,
  MAX_AMPLITUDE,
  MAX_DETUNE_CENTS,
  MAX_UNISON_SUSTAINED,
  MAX_UNISON_TRIGGERED,
  noteLabel,
  noteToFrequency,
  rateCompensatedCents,
  reverbMixLevels,
  sanitizeAmplitude,
  SCALES,
  unisonDetuneCents,
  widthCoefficients,
  type EffectSlot,
} from "../src/index.ts";

let checks = 0;
const failures: string[] = [];

function ok(name: string, condition: boolean): void {
  checks += 1;
  if (!condition) failures.push(name);
}

function near(name: string, actual: number, expected: number, eps = 1e-9): void {
  ok(`${name} (got ${actual}, want ${expected})`, Math.abs(actual - expected) <= eps);
}

/* --------------------------------- pitch --------------------------------- */

near("A4 is 440 Hz", noteToFrequency(69), 440);
near("an octave up doubles", noteToFrequency(81), 880);
near("a semitone is the twelfth root of two", noteToFrequency(70), 440 * Math.pow(2, 1 / 12));
ok("middle C is labelled C4", noteLabel(60) === "C4");
ok("the label wraps below C", noteLabel(59) === "B3");
ok("a scale registry entry carries its degrees", SCALES.pentatonic.degrees.length === 5);

/* -------------------------------- unison --------------------------------- */

// The reference pitch is where a stored spread is literal, so compensation must
// be the identity there and nowhere else.
near("compensation is the identity at the reference", rateCompensatedCents(DETUNE_REFERENCE_HZ, 12), 12);
ok(
  "compensation widens as pitch falls",
  rateCompensatedCents(110, 12) > rateCompensatedCents(DETUNE_REFERENCE_HZ, 12),
);
ok(
  "compensation narrows as pitch rises",
  rateCompensatedCents(880, 12) < rateCompensatedCents(DETUNE_REFERENCE_HZ, 12),
);
ok("a spread is never wider than the ceiling", rateCompensatedCents(27.5, 50) <= MAX_DETUNE_CENTS);
ok("no spread means no spread", rateCompensatedCents(440, 0) === 0);
ok("a garbage spread is total", Number.isFinite(rateCompensatedCents(440, Number.NaN)));
ok("a garbage frequency is total", Number.isFinite(rateCompensatedCents(Number.NaN, 12)));

// The stack must stay centred on the written pitch, or every note sounds flat or
// sharp by half its own spread.
for (const n of [1, 2, 3, 5, 8]) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += unisonDetuneCents(440, 12, i, n);
  near(`a ${n}-voice stack sums to zero`, sum, 0, 1e-9);
}
ok(
  "a single oscillator is not detuned",
  unisonDetuneCents(440, 12, 0, 1) === 0,
);
ok(
  "the outer voices of a stack are symmetric",
  Math.abs(unisonDetuneCents(440, 12, 0, 4) + unisonDetuneCents(440, 12, 3, 4)) < 1e-12,
);

ok("a triggered voice may use the full stack", clampUnison(8, MAX_UNISON_TRIGGERED) === 8);
ok("a sustained voice is capped thin", clampUnison(8, MAX_UNISON_SUSTAINED) === MAX_UNISON_SUSTAINED);
ok("a stack is never empty", clampUnison(0) === 1);
ok("a garbage count is total", clampUnison(Number.NaN) === 1);

/* -------------------------------- level ---------------------------------- */

// Falling back to unity rather than to zero is the whole point: zero is silence,
// and silence is indistinguishable from a quiet mix.
ok("a missing amplitude falls back to unity", sanitizeAmplitude(undefined) === DEFAULT_AMPLITUDE);
ok("a non-finite amplitude falls back to unity", sanitizeAmplitude(Number.NaN) === DEFAULT_AMPLITUDE);
ok("a text amplitude falls back to unity", sanitizeAmplitude("0.5") === DEFAULT_AMPLITUDE);
ok("amplitude is clamped at the ceiling", sanitizeAmplitude(4) === MAX_AMPLITUDE);
ok("a negative amplitude is clamped to silence", sanitizeAmplitude(-1) === 0);
ok("unity passes through", sanitizeAmplitude(1) === 1);

/* -------------------------------- stereo --------------------------------- */

// The two coefficients summing to one is what makes a dual-mono source pass at
// unity for every width. If that ever stops holding, a mono voice loses 6 dB the
// moment a width stage is inserted, and nothing reports it.
for (const w of [0, 0.5, 1, 1.4, 2]) {
  const { a, b } = widthCoefficients(w);
  near(`width ${w} coefficients sum to one`, a + b, 1);
}
ok("unity width passes the left channel alone", widthCoefficients(1).a === 1 && widthCoefficients(1).b === 0);
ok("zero width is a dual-mono fold", widthCoefficients(0).a === 0.5);
ok("a width past the range is clamped", widthCoefficients(5).a === widthCoefficients(2).a);
ok("a garbage width falls back to unity", widthCoefficients(Number.NaN).a === 1);

ok("zero mix is exactly dry", reverbMixLevels(0).dry === 1 && reverbMixLevels(0).wet === 0);
ok("full mix is exactly wet", reverbMixLevels(1).wet === 1);
for (const m of [0, 0.3, 0.5, 1]) {
  const { dry, wet } = reverbMixLevels(m);
  near(`mix ${m} splits to one`, dry + wet, 1);
}

/* --------------------------------- chain --------------------------------- */

const slots: EffectSlot[] = [
  { id: "a", type: "lowpass", enabled: true, params: {} },
  { id: "b", type: "width", enabled: false, params: {} },
  { id: "c", type: "convolver", enabled: true, params: {} },
];
ok("a fingerprint skips what is not built", effectChainFingerprint(slots) === "a:lowpass|c:convolver");
ok("an all-disabled chain has no fingerprint", effectChainFingerprint([]) === "");
ok(
  "toggling a slot changes the fingerprint",
  effectChainFingerprint(slots) !==
    effectChainFingerprint(slots.map((s) => (s.id === "b" ? { ...s, enabled: true } : s))),
);

/* ---------------------------------- wav ---------------------------------- */

const wav = encodeWavMono(new Float32Array([0, 0.5, -1, 2]), 48000);
const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
const tag = (at: number): string => String.fromCharCode(wav[at], wav[at + 1], wav[at + 2], wav[at + 3]);
ok("the file is RIFF", tag(0) === "RIFF");
ok("the file is WAVE", tag(8) === "WAVE");
ok("the format chunk is named", tag(12) === "fmt ");
ok("the data chunk is named", tag(36) === "data");
ok("the header is 44 bytes plus two per sample", wav.byteLength === 44 + 8);
ok("the declared data length matches", view.getUint32(40, true) === 8);
ok("the sample rate is written", view.getUint32(24, true) === 48000);
ok("it is mono", view.getUint16(22, true) === 1);
ok("silence encodes as zero", view.getInt16(44, true) === 0);
ok("a sample past full scale is clamped, not wrapped", view.getInt16(50, true) === 32767);

const peaks = computePeaks(new Float32Array([0.5, -0.25, 1, -1]), 2);
ok("peaks come back in the buckets asked for", peaks.length === 2);
ok("a bucket keeps both extremes", peaks[1].max === 1 && peaks[1].min === -1);
ok("no samples means no peaks", computePeaks(new Float32Array(0), 4).length === 0);

/* -------------------------------- report --------------------------------- */

if (failures.length > 0) {
  console.error(`${failures.length} of ${checks} checks failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  // Thrown rather than a status code, so this script needs no Node types and
  // still fails loudly in whatever runs it.
  throw new Error(`${failures.length} checks failed`);
}
console.log(`verify: ${checks}/${checks} checks passed`);
