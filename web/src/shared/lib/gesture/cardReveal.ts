/** Where a swipe-to-reveal card rests, and when it settles open: the geometry of a card that slides to show tiles. */

/** The size (px) of one swipe action tile, and the gap around the tiles. */
export const ACTION_TILE = 48;
export const ACTION_GAP = 8;

/** The side a card has slid open: `right` shows the tiles on its right (a swipe to the left). */
export type RevealSide = 'left' | 'right';

/** The width (px) a row of `count` tiles takes, with a gap around each; none takes no room. */
export function actionsWidth(count: number): number {
  return count === 0 ? 0 : count * ACTION_TILE + (count + 1) * ACTION_GAP;
}

/** Where a card rests (px) when `side` is open: positive slides it right. */
export function revealOffset(
  side: RevealSide | null,
  leftWidth: number,
  rightWidth: number,
): number {
  if (side === 'left') return leftWidth;
  if (side === 'right') return -rightWidth;
  return 0;
}

/** The speed (px/ms) that turns even a short flick of a card into a decision. */
export const LANE_FLICK_SPEED = 0.5;

/**
 * How far (px) a card has slid: the drag from where it began, between the two sides' tiles. Past
 * them, or towards a side with no tiles, it gives only a quarter of the drag.
 */
export function cardOffset(
  startOffset: number,
  dx: number,
  leftWidth: number,
  rightWidth: number,
): number {
  const raw = startOffset + dx;
  if (raw > leftWidth) return leftWidth + (raw - leftWidth) / 4;
  if (raw < -rightWidth) return -rightWidth + (raw + rightWidth) / 4;
  return raw;
}

/** The side a released card stays open on: past half its tiles, or flicked that way. */
export function cardSettles(
  offset: number,
  velocity: number,
  leftWidth: number,
  rightWidth: number,
): RevealSide | null {
  if (offset < 0 && rightWidth > 0) {
    if (velocity >= LANE_FLICK_SPEED) return null;
    return velocity <= -LANE_FLICK_SPEED || offset <= -rightWidth / 2 ? 'right' : null;
  }
  if (offset > 0 && leftWidth > 0) {
    if (velocity <= -LANE_FLICK_SPEED) return null;
    return velocity >= LANE_FLICK_SPEED || offset >= leftWidth / 2 ? 'left' : null;
  }
  return null;
}

/** How far a swipe has opened a side's tiles, from 0 (closed) to 1 (fully revealed). */
export function revealProgress(offset: number, width: number): number {
  if (width <= 0) return 0;
  return Math.min(1, Math.max(0, Math.abs(offset) / width));
}
