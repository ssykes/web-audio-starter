/**
 * Moving a parameter without clicking.
 *
 * Every continuous control in an audio path wants a target and a rate, never an
 * assignment. A voice can sound for minutes while a slider moves under it, and a
 * direct write to `value` is a step — audible as a click, and on a level it is
 * audible as a jump.
 */

/** Below this a slew is indistinguishable from a step, so it is not worth one. */
export const MIN_SLEW_SECONDS = 0.005;

/**
 * One-pole parameter follower.
 *
 * `setTargetAtTime` needs no end time, which is what makes an estimated duration
 * safe: when the estimate is revised the target simply moves and the value
 * glides toward it. There is no schedule to cancel and no gap to paper over.
 *
 * Holding first is load-bearing. Cancelling scheduled values without holding
 * would snap the parameter back to an earlier scheduled value, and cancelling
 * nothing at all lets the automation timeline accumulate an event per voice per
 * tick forever — a slow leak that looks like a stutter long before it looks like
 * a leak.
 */
export function follow(param: AudioParam, value: number, now: number, tau: number): void {
  param.cancelAndHoldAtTime(now);
  param.setTargetAtTime(value, now, Math.max(MIN_SLEW_SECONDS, tau));
}
