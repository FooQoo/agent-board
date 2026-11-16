import type { RefObject } from 'react';
import { useSwipePages } from '@/shared/lib/gesture/useSwipePages';
import type { MonitorSection } from '../components/MonitorSectionHeader';
import { LANES } from '../model/lanes';

/** A card that is chosen: its sideways moves slide it, not the lanes. */
export const CHOSEN_CARD = '[data-swipe-card][data-armed]';
const KEEPS_ITS_SWIPE = `[data-lane-ignore],[data-swipe-action],${CHOSEN_CARD}`;

/**
 * The lanes as swipe pages: a sideways swipe anywhere moves to the next lane, except on a chosen
 * card, on its tiles or on a control marked `data-lane-ignore`. As in the detail drawer, the tab
 * marker follows the finger (`--lane-progress` on the tab bar), and the tab is selected as soon
 * as the release decides the lane.
 */
export function useLaneCarousel(
  lane: MonitorSection,
  onLaneChange: (lane: MonitorSection) => void,
  tabs?: RefObject<HTMLElement | null>,
) {
  return useSwipePages(LANES, lane, onLaneChange, {
    ignore: (target) => Boolean(target?.closest(KEEPS_ITS_SWIPE)),
    progressTarget: tabs,
    progressVar: '--lane-progress',
  });
}
