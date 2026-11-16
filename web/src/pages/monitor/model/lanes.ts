import type { MonitorSection } from '../components/MonitorSectionHeader';

/** The lanes in the order the phone shows them, left to right. */
export const LANES: readonly MonitorSection[] = ['todo', 'doing', 'done'];

/** A card is held this long (ms) before it lifts; the same hold as the board's touch drag. */
export const LIFT_HOLD_MS = 100;
/** A finger may drift this far (px) during that hold and still lift the card. */
export const LIFT_TOLERANCE = 10;
/** How far (px) a press must move sideways before it counts as a swipe. */
export const SWIPE_SLOP = 8;
/** The size (px) of one swipe action tile, and the gap around the tiles. */
export const ACTION_TILE = 48;
export const ACTION_GAP = 8;

/** The side a card has slid open: `right` shows the tiles on its right (a swipe to the left). */
export type RevealSide = 'left' | 'right';

/**
 * The tiles a swipe shows, by the side they appear on. A swipe to the left shows the lane on the
 * right and the archive; a swipe to the right shows the lane on the left. A lane at an end of the
 * row has no tile for the lane beyond it.
 */
export function swipeActions(lane: MonitorSection): {
  left: MonitorSection[];
  right: (MonitorSection | 'archive')[];
} {
  const before = neighbourLane(lane, -1);
  const after = neighbourLane(lane, 1);
  return { left: before ? [before] : [], right: [...(after ? [after] : []), 'archive'] };
}

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
/** The band (px) at the top and bottom of a lane where a held card scrolls it. */
export const AUTOSCROLL_ZONE = 56;
/** The distance, as a share of the lane width, that turns a drag into a lane change. */
export const LANE_SWITCH_RATIO = 0.25;
/** The speed (px/ms) that turns even a short flick into a lane change. */
export const LANE_FLICK_SPEED = 0.5;

export type Direction = -1 | 1;

export function laneIndex(lane: MonitorSection): number {
  return LANES.indexOf(lane);
}

/** The lane next to `lane` in `direction` (1 is right), or null at the end of the row. */
export function neighbourLane(lane: MonitorSection, direction: Direction): MonitorSection | null {
  return LANES[laneIndex(lane) + direction] ?? null;
}

/** Keeps a position on the three lanes, so a drag past an end of the row stops there. */
export function clampLaneIndex(index: number): number {
  return Math.min(LANES.length - 1, Math.max(0, Math.round(index)));
}

/** Which way a press has gone once it passed the slop: a sideways swipe, a scroll, or neither yet. */
export function swipeAxis(dx: number, dy: number, slop = SWIPE_SLOP): 'x' | 'y' | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < slop) return null;
  return ax > ay ? 'x' : 'y';
}

/** True while the finger still counts as holding still, so the card may lift. */
export function withinLiftTolerance(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) <= LIFT_TOLERANCE;
}

/** The lane a sideways drag on empty space ends in. Past either end it stays where it is. */
export function settleLane(
  lane: MonitorSection,
  dx: number,
  velocity: number,
  width: number,
): MonitorSection {
  const far = Math.abs(dx) >= width * LANE_SWITCH_RATIO;
  const flick = Math.abs(velocity) >= LANE_FLICK_SPEED && Math.abs(dx) > SWIPE_SLOP;
  if (!far && !flick) return lane;
  // A drag to the left (negative) reveals the lane on the right.
  return neighbourLane(lane, dx < 0 ? 1 : -1) ?? lane;
}

/** The track's offset (px) while a drag is under way: it follows the finger, and gives at an end. */
export function trackOffset(lane: MonitorSection, dx: number, width: number): number {
  const base = -laneIndex(lane) * width;
  const blocked = neighbourLane(lane, dx < 0 ? 1 : -1) === null;
  return base + (blocked ? dx / 3 : dx);
}

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

/** The lanes whose cards a long press reorders. 完了 keeps the order the cards were completed in. */
export function canReorder(lane: MonitorSection): boolean {
  return lane !== 'done';
}

/** Where a held card would land: the number of the other cards whose middle is above `y`. */
export function dropSlot(middles: readonly number[], y: number): number {
  return middles.filter((middle) => middle < y).length;
}

/** The lane's order once the held card lands in `slot` among the other cards. */
export function reorderIds(ids: readonly number[], liftedId: number, slot: number): number[] {
  const others = ids.filter((id) => id !== liftedId);
  others.splice(Math.min(Math.max(slot, 0), others.length), 0, liftedId);
  return others;
}

/**
 * The card the held card is put before when it lands in `slot` (null: the end of the lane), or
 * undefined when it lands where it already was and nothing needs saving.
 */
export function reorderBefore(
  ids: readonly number[],
  liftedId: number,
  slot: number,
): number | null | undefined {
  const next = reorderIds(ids, liftedId, slot);
  if (next.every((id, index) => id === ids[index])) return undefined;
  return next[next.indexOf(liftedId) + 1] ?? null;
}

/**
 * How far (px) each card moves while the held card would land in `slot`: the lane is laid out
 * again in the new order with the same heights and gaps, so the others make room for it.
 */
export function reorderShifts(
  ids: readonly number[],
  tops: readonly number[],
  heights: readonly number[],
  liftedId: number,
  slot: number,
): Map<number, number> {
  const shifts = new Map<number, number>();
  if (ids.length === 0) return shifts;
  const gap = ids.length > 1 ? (tops[1] ?? 0) - ((tops[0] ?? 0) + (heights[0] ?? 0)) : 0;
  let top = tops[0] ?? 0;
  for (const id of reorderIds(ids, liftedId, slot)) {
    const index = ids.indexOf(id);
    shifts.set(id, top - (tops[index] ?? 0));
    top += (heights[index] ?? 0) + gap;
  }
  return shifts;
}

/** How far a swipe has opened a side's tiles, from 0 (closed) to 1 (fully revealed). */
export function revealProgress(offset: number, width: number): number {
  if (width <= 0) return 0;
  return Math.min(1, Math.max(0, Math.abs(offset) / width));
}
