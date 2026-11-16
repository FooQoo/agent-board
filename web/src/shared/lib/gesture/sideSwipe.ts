/** How far (px) a press must move before it counts as a swipe or a scroll. */
export const SWIPE_SLOP = 8;
/** How long (ms) a press must stay still to count as a hold. */
export const HOLD_MS = 300;
/**
 * How far (px) a finger may drift during a hold. It is below the swipe slop, so a press that moves
 * sooner becomes a swipe or a scroll before the hold completes.
 */
export const HOLD_TOLERANCE = 6;

/** Which way a press has gone once it passed the slop: sideways, up or down, or neither yet. */
export function swipeAxis(dx: number, dy: number, slop = SWIPE_SLOP): 'x' | 'y' | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < slop) return null;
  return ax > ay ? 'x' : 'y';
}

/** Whether a press has stayed close enough to where it began to count as a hold. */
export function withinHoldTolerance(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) <= HOLD_TOLERANCE;
}
