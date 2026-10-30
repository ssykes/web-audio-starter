# Web Audio starter

A minimal TypeScript starting point for browser audio: the pitch, unison, level,
slew, effect-chain and sample utilities that a Web Audio project ends up writing
anyway, extracted from a larger sonification project and stripped of everything
specific to it. No feed, no editor, no framework, no runtime dependencies.

```
npm install
npm run dev        # the example, at http://localhost:5173
npm run verify     # 61 assertions over the pure half, in Node
npm run build      # typecheck, then bundle the example
```

## What is here

Two kinds of thing, kept in separate modules on purpose.

**Pure arithmetic** — `pitch.ts`, `unison.ts`, `amplitude.ts`, and the three
coefficient functions in `effects.ts`. No Web Audio, no DOM, runs in Node, and
asserted by `npm run verify`. This is where the silent failures live: a wrong
number is not an error, it is a different sound, and it plays perfectly happily.

**Builders** — everything that takes a `BaseAudioContext` and returns nodes.
Browser only. The example exercises them; nothing asserts them, because a node
graph cannot be checked without hearing it.

`src/index.ts` re-exports all of it. Import from there, or from a module directly.

## Public API

### `pitch.ts`

| Export | Signature | Notes |
| --- | --- | --- |
| `NOTE_NAMES` | `string[]` | chromatic, sharps only |
| `noteToFrequency` | `(note: number) => number` | equal-tempered Hz, A4 = 440 |
| `noteLabel` | `(midi: number) => string` | 60 → `"C4"` |
| `ScaleDescriptor` | `{ id, label, degrees }` | degrees are semitones within one octave |
| `SCALES` | `Record<string, ScaleDescriptor>` | dorian, aeolian, pentatonic, major-pentatonic, lydian |

A registry rather than a union, so adding a scale is one entry and every reader
sees it without being edited.

### `unison.ts`

| Export | Signature | Notes |
| --- | --- | --- |
| `DETUNE_REFERENCE_HZ` | `220` | the pitch a stored spread is calibrated at |
| `MAX_DETUNE_CENTS` | `50` | ceiling on a compensated spread |
| `rateCompensatedCents` | `(frequency, detuneCents) => number` | the spread that beats at the same rate at `frequency` |
| `unisonDetuneCents` | `(frequency, detuneCents, index, unison) => number` | one oscillator's offset, symmetric about zero |
| `MAX_UNISON_TRIGGERED` | `8` | short event-driven voices, few at a time |
| `MAX_UNISON_SUSTAINED` | `2` | long drones, up to a voice ceiling of them |
| `clampUnison` | `(unison, cap = MAX_UNISON_TRIGGERED) => number` | never below 1, total for garbage input |

Two oscillators a fixed number of cents apart beat at a rate proportional to
pitch, so one literal spread for a whole stack wobbles slowly in the bass and
flutters at 6 Hz in the treble. Compensation holds the beat rate constant
instead. The stack sums to zero, so it stays centred on the written note.

The cap belongs at build time, never in stored data: clamping on the way in would
rewrite what a caller asked for and make one number mean two things.

### `amplitude.ts`

| Export | Signature | Notes |
| --- | --- | --- |
| `DEFAULT_AMPLITUDE` | `1` | unity |
| `MAX_AMPLITUDE` | `1.5` | a trim that cannot exceed unity cannot make anything louder |
| `sanitizeAmplitude` | `(value: unknown) => number` | clamps to `0…1.5`, total |

A missing or non-finite value falls back to **unity, not zero**. Zero is the
silent failure — every counter stays clean and nothing plays. Unity sounds like
an unedited voice, which is audible as "not what I set".

### `slew.ts`

| Export | Signature | Notes |
| --- | --- | --- |
| `MIN_SLEW_SECONDS` | `0.005` | below this a slew is a step |
| `follow` | `(param, value, now, tau) => void` | one-pole follower |

Holds before retargeting. Cancelling scheduled values without holding snaps the
parameter back to an earlier value, and cancelling nothing at all lets the
automation timeline accumulate an event per voice per tick forever.

### `effects.ts`

| Export | Signature | Notes |
| --- | --- | --- |
| `ParamDescriptor` | `{ key, label, min, max, step, unit?, log? }` | one number an effect exposes |
| `EffectTypeDescriptor` | `{ id, label, blurb, params }` | |
| `EFFECT_TYPES` | `Record<string, EffectTypeDescriptor>` | lowpass, convolver, width, tremolo |
| `EffectSlot` | `{ id, type, enabled, params }` | one ordered instance |
| `widthCoefficients` | `(width) => { a, b }` | pure; `a + b === 1` always |
| `reverbMixLevels` | `(mix) => { dry, wet }` | pure; zero mix is exactly dry |
| `effectChainFingerprint` | `(slots) => string` | the enabled slots, in order |
| `impulseResponse` | `(ctx, seconds, decay?) => AudioBuffer` | decorrelated stereo noise |
| `createWidth` | `(ctx, width) => WidthStage` | mid/side matrix, mono-safe |
| `createReverbSend` | `(ctx, { mix, seconds }) => ReverbStage` | parallel send |
| `buildEffectChain` | `(ctx, slots) => EffectChain` | serial chain over the enabled slots |
| `AudioStage` | `{ input, output, dispose() }` | what every stage satisfies |

Two rules, both because the failure is silent.

A mono source through a width matrix collapses to one channel, so `createWidth`
up-mixes to dual mono first; with the coefficients summing to one, dual mono
passes at unity for every width rather than losing 6 dB.

Every parameter is slewed, never assigned. A voice can sound for minutes while a
control moves under it.

Structure changes are not live. `update` slews the stages already built and
ignores a mismatched list; compare `effectChainFingerprint` and rebuild when it
differs, because a convolver cannot be spliced into a running chain without a
discontinuity. A type the registry declares but nothing implements becomes a
passthrough rather than breaking the chain.

### `sample.ts`

| Export | Signature | Notes |
| --- | --- | --- |
| `PeakBucket` · `DecodedSample` | types | |
| `PEAK_BUCKETS` | `1200` | buckets per decoded sample |
| `encodeWavMono` | `(samples, sampleRate) => Uint8Array` | 16-bit PCM, clamped not wrapped |
| `computePeaks` | `(samples, buckets) => PeakBucket[]` | min and max per bucket |
| `downmixToMono` | `(buffer) => Float32Array` | equal weight |
| `decodeSampleFile` | `(file, ctx) => Promise<DecodedSample>` | throws if the container will not decode |
| `createDemoSample` | `(ctx) => DecodedSample` | generated pluck sequence |

Peaks rather than every sample, because a canvas a thousand pixels wide cannot
show a million frames and picking one frame per pixel loses the transients —
which is what a waveform is looked at for. The demo sample exists so a starter is
audible with no binary asset in the repo.

## Two habits the code assumes

Create the `AudioContext` inside a user gesture. Created earlier it starts
suspended and nothing sounds, with no error anywhere.

Slew a continuous parameter to its target. A direct write to `value` is a click,
and on a level it is a jump.

## Deliberately not here

No voice or instrument — the example builds one in about forty lines from the
pieces above, and whatever you are making will want a different one. No
scheduling, no sequencer, no MIDI, no framework, no UI components. No spatial
audio: the source project's distance and panning code was tied to a transit
network and did not generalise.

## Provenance

Extracted from a BART sonification project. Three things were renamed on the way
out, because their old names were that project's vocabulary: the unison ceilings
were named for two kinds of train voice, the unison clamp took a whole voice
configuration rather than a number, and the amplitude sanitizer took one too.
The reasoning in the comments is theirs and is the reason this exists.

## Verification status

`npm run verify` passes 61 assertions and `npm run build` typechecks and bundles
clean. **The example has never been heard.** It was written on a machine with no
browser, so the builders are verified as types and as arithmetic, not as sound —
run `npm run dev` and press Start before trusting any of it.
