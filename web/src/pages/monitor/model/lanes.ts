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
/** The width (px) a card reveals: the two other lanes and the archive tile, with their gaps. */
export const REVEAL_WIDTH = 3 * ACTION_TILE + 4 * ACTION_GAP;
/** The strip (px) at each screen edge where a lifted card asks for the next lane. */
export const EDGE_ZONE = 56;
/** How long (ms) a lifted card rests in an edge strip before the lane changes. */
export const EDGE_DWELL_MS = 600;
/** The distance, as a share of the lane width, that turns a drag into a lane change. */
export const LANE_SWITCH_RATIO = 0.25;
/** The speed (px/ms) that turns even a short flick into a lane change. */
export const LANE_FLICK_SPEED = 0.5;

export type Direction = -1 | 1;
export type Edge = 'left' | 'right';

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

/** How far (px) a card has slid: the drag from where it began, between closed and fully revealed. */
export function cardOffset(startOffset: number, dx: number): number {
  const raw = startOffset + dx;
  if (raw > 0) return raw / 4;
  if (raw < -REVEAL_WIDTH) return -REVEAL_WIDTH + (raw + REVEAL_WIDTH) / 4;
  return raw;
}

/** Whether a released card stays open: past half the button, or flicked to the left. */
export function cardSettlesOpen(offset: number, velocity: number): boolean {
  if (velocity <= -LANE_FLICK_SPEED) return true;
  if (velocity >= LANE_FLICK_SPEED) return false;
  return offset <= -REVEAL_WIDTH / 2;
}

/** The edge strip a pointer is in, or null. A lane with no neighbour on that side has no strip. */
export function edgeOf(x: number, width: number, zone = EDGE_ZONE): Edge | null {
  if (x <= zone) return 'left';
  if (x >= width - zone) return 'right';
  return null;
}

/** The lane an edge asks for from `lane`, or null when the row ends there. */
export function edgeTarget(lane: MonitorSection, edge: Edge | null): MonitorSection | null {
  if (edge === null) return null;
  return neighbourLane(lane, edge === 'left' ? -1 : 1);
}

/**
 * Tells whether the dwell clock should run. It runs while the pointer rests in a strip that has a
 * neighbour, and only once the pointer has left the strip since the last change, so a card that
 * stays at the edge moves one lane and not three.
 */
export function dwellEdge(
  lane: MonitorSection,
  edge: Edge | null,
  armed: boolean,
): { edge: Edge | null; run: boolean; armed: boolean } {
  if (edge === null) return { edge: null, run: false, armed: true };
  if (edgeTarget(lane, edge) === null) return { edge: null, run: false, armed };
  return { edge, run: armed, armed };
}

/** The lanes a card can be moved to from its own lane, in board order. */
export function otherLanes(lane: MonitorSection): MonitorSection[] {
  return LANES.filter((name) => name !== lane);
}

/** How far a swipe has opened the actions, from 0 (closed) to 1 (fully revealed). */
export function revealProgress(offset: number): number {
  return Math.min(1, Math.max(0, -offset / REVEAL_WIDTH));
}
