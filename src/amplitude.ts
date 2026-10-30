/**
 * Amplitude, and the boundary every level value crosses on its way to a gain.
 *
 * This is the one arithmetic in an audio path that cannot be left inline,
 * because its failure is silence and silence is indistinguishable from a quiet
 * mix. A non-finite number reaching an `AudioParam` renders as nothing at all
 * while every counter reads clean, so there is nothing to debug from.
 */

/** Unity, and what something with no opinion of its own plays at. */
export const DEFAULT_AMPLITUDE = 1;

/**
 * The top of a level trim.
 *
 * 1.5 rather than 1 because a trim that cannot exceed unity cannot make
 * anything louder, which is half of what a trim is for. The clamp is what keeps
 * a control honest: a value of 4 would otherwise play at 4 while the thing that
 * set it showed 1.5.
 */
export const MAX_AMPLITUDE = 1.5;

/**
 * The amplitude a voice actually plays at.
 *
 * Total by construction — it answers for a missing, non-numeric, negative or
 * absurd field rather than throwing, because the value may have come off a
 * network or out of a hand-authored file.
 *
 * **A non-finite amplitude falls back to unity, not to zero.** Zero is the
 * silent failure: every counter stays clean and nothing plays. Falling back to
 * unity means a corrupt field sounds like an unedited voice, which is audible as
 * "not what I set" rather than indistinguishable from a quiet mix.
 */
export function sanitizeAmplitude(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_AMPLITUDE;
  return Math.max(0, Math.min(MAX_AMPLITUDE, value));
}
