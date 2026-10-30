/**
 * Unison stacks: how many oscillators per note, and how far apart they sit.
 *
 * Pure arithmetic, so it runs in Node and can be asserted. A wrong spread is
 * not an error — it is a different sound, and it plays perfectly happily. The
 * compensation below reached its author as a bug report rather than as a stack
 * trace: one literal spread for the whole stack wobbled slowly in the bass and
 * fluttered at 6 Hz in the treble, which reads as a tremolo nobody asked for.
 */

/**
 * The pitch a detune spread is calibrated at, Hz — A3.
 *
 * Named rather than inlined because it is the whole meaning of a spread: the
 * number a caller stores is the spread *here*, and every other pitch derives its
 * own from it. Moving this re-calibrates every voice at once. A3 sits in the
 * middle of the register a pad usually occupies, so the adjustment stays modest
 * in both directions.
 */
export const DETUNE_REFERENCE_HZ = 220;

/**
 * The ceiling on a compensated spread, cents.
 *
 * Compensation pushes the spread up as pitch falls, without limit: holding a
 * 1.5 Hz beat at A0 needs 79 cents, which is an out-of-tune stack rather than a
 * chorused one. Clamped where the number becomes sound rather than where it is
 * stored, so a document claiming more still round-trips unchanged.
 */
export const MAX_DETUNE_CENTS = 50;

/**
 * The spread, in cents, that beats at the same rate at `frequency` as
 * `detuneCents` beats at `DETUNE_REFERENCE_HZ`.
 *
 * Two oscillators a given number of cents apart beat at a rate proportional to
 * pitch, which is why one spread cannot serve a whole chord. Holding the rate
 * constant means solving that relationship for the spread at each pitch.
 *
 * Total by construction: a missing or non-finite spread means no spread, and a
 * non-positive frequency falls back to the requested cents, because there is no
 * pitch to compensate against and inventing one would move the stack off the
 * written note.
 */
export function rateCompensatedCents(frequency: number, detuneCents: number): number {
  const requested = Number.isFinite(detuneCents) ? Math.max(0, detuneCents) : 0;
  if (requested === 0) return 0;
  const cap = (cents: number): number => Math.min(MAX_DETUNE_CENTS, cents);
  if (!Number.isFinite(frequency) || frequency <= 0) return cap(requested);
  const beatHz = DETUNE_REFERENCE_HZ * (Math.pow(2, requested / 1200) - 1);
  const compensated = 1200 * Math.log2(1 + beatHz / frequency);
  if (!Number.isFinite(compensated)) return cap(requested);
  return cap(Math.max(0, compensated));
}

/**
 * One oscillator's detune offset within a unison stack, in cents.
 *
 * Spread symmetrically about zero so the stack stays centred on the written
 * pitch, and compensated per note so every chord member beats at the same rate.
 * One function rather than the same expression inlined at every call site: a
 * preview that computes it slightly differently from the player auditions a
 * spread the piece does not use, and nothing fails when that happens.
 */
export function unisonDetuneCents(
  frequency: number,
  detuneCents: number,
  index: number,
  unison: number,
): number {
  const n = Math.max(1, Math.round(Number.isFinite(unison) ? unison : 1));
  const i = Number.isFinite(index) ? index : 0;
  return (i - (n - 1) / 2) * rateCompensatedCents(frequency, detuneCents);
}

/**
 * Oscillators per note for a short, triggered voice — a note struck by an event
 * and gone again. Only a few of these sound at once, so the stack can be thick.
 */
export const MAX_UNISON_TRIGGERED = 8;

/**
 * Oscillators per note for a long, sustained voice — a drone or a bed that runs
 * for minutes. Up to a voice ceiling of these can sound at once, so the stack
 * has to be thin: eight oscillators times four notes times sixteen voices is 512
 * against the triggered tier's 32.
 */
export const MAX_UNISON_SUSTAINED = 2;

/**
 * The oscillator count a voice will actually build.
 *
 * The cap belongs at build time, never in stored data. Clamping on the way in
 * would quietly rewrite what a caller asked for and make the same number mean
 * two things; clamping on the way out leaves the request intact and lets a
 * surface show both what was asked and what will play.
 */
export function clampUnison(unison: number, cap: number = MAX_UNISON_TRIGGERED): number {
  const n = Math.round(Number.isFinite(unison) ? unison : 1);
  return Math.max(1, Math.min(cap, n));
}
