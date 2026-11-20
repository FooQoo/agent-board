import type { MonitorSection } from '../components/MonitorSectionHeader';

export {
  ACTION_GAP,
  ACTION_TILE,
  actionsWidth,
  cardOffset,
  cardSettles,
  LANE_FLICK_SPEED,
  type RevealSide,
  revealOffset,
  revealProgress,
} from '@/shared/lib/gesture/cardReveal';

/** The lanes in the order the phone shows them, left to right. */
export const LANES: readonly MonitorSection[] = ['todo', 'doing', 'done'];

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

export type Direction = -1 | 1;

export function laneIndex(lane: MonitorSection): number {
  return LANES.indexOf(lane);
}

/** The lane next to `lane` in `direction` (1 is right), or null at the end of the row. */
export function neighbourLane(lane: MonitorSection, direction: Direction): MonitorSection | null {
  return LANES[laneIndex(lane) + direction] ?? null;
}
