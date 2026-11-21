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
export const LANES: readonly MonitorSection[] = ['backlog', 'todo', 'doing', 'done'];

/**
 * The tiles a swipe shows, by the side they appear on. A swipe to the left shows the lane on the
 * right and the archive; a swipe to the right shows the lane on the left. A lane at an end of the
 * row has no tile for the lane beyond it; Todo's left tile is the Backlog.
 */
export function swipeActions(
  lane: MonitorSection,
  canReturn = true,
): {
  left: MonitorSection[];
  right: SwipeTile[];
} {
  // A plan in the Backlog is sent to Todo from the selection mode, which the first tile starts.
  if (lane === 'backlog') return { left: [], right: ['select', 'archive'] };
  // A Todo card goes back to the Backlog while nobody has started it (`canReturn`); the server
  // refuses a card that has been started and says why.
  const before = lane === 'todo' && !canReturn ? null : neighbourLane(lane, -1);
  const after = neighbourLane(lane, 1);
  return { left: before ? [before] : [], right: [...(after ? [after] : []), 'archive'] };
}

/** What a swipe tile does: moves the card to a lane, archives it, or starts the selection mode. */
export type SwipeTile = MonitorSection | 'archive' | 'select';

export type Direction = -1 | 1;

export function laneIndex(lane: MonitorSection): number {
  return LANES.indexOf(lane);
}

/** The lane next to `lane` in `direction` (1 is right), or null at the end of the row. */
export function neighbourLane(lane: MonitorSection, direction: Direction): MonitorSection | null {
  return LANES[laneIndex(lane) + direction] ?? null;
}
