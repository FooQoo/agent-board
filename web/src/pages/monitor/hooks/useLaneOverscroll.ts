import { type RefObject, useState } from 'react';
import { cardOffset } from '@/shared/lib/gesture/cardReveal';
import { useSideSwipe } from '@/shared/lib/gesture/useSideSwipe';
import { actionsWidth } from '../model/lanes';
import { CHOSEN_CARD } from './useLaneCarousel';

/** How far (px) a swipe must go past the last lane to count. */
export const OVERSCROLL_DISTANCE = 72;
/** The room (px) the Archive all tile takes while the lane follows the finger: one card tile. */
export const BULK_WIDTH = actionsWidth(1);
const KEEPS_ITS_SWIPE = `[data-lane-ignore],[data-swipe-action],${CHOSEN_CARD}`;

/**
 * A swipe to the left that starts while the last lane is on screen has no lane to go to. While the
 * finger is down the lane follows it (`offset`, negative to the left) and uncovers a tile on its
 * right, as a card does. Past `OVERSCROLL_DISTANCE`, and clearly sideways, it calls `onOverscroll`
 * when the finger lifts; either way the lane springs back. A press on a chosen card, on its tiles
 * or on a control marked `data-lane-ignore` keeps its own swipe and is not read, and a move to the
 * right is left to the lane carousel. Nothing is read while `enabled` is false.
 */
export function useLaneOverscroll(
  lane: RefObject<HTMLElement | null>,
  enabled: boolean,
  onOverscroll: () => void,
) {
  const [drag, setDrag] = useState<number | null>(null);
  const { consumesClick, handlers } = useSideSwipe(lane, {
    active: enabled,
    disabled: !enabled,
    ignore: KEEPS_ITS_SWIPE,
    accepts: (dx) => dx < 0 && !lane.current?.querySelector(CHOSEN_CARD),
    onSlide: (dx) => setDrag(cardOffset(0, dx, 0, BULK_WIDTH)),
    onRelease: (dx, _velocity, cancelled, dy) => {
      setDrag(null);
      if (!cancelled && dx <= -OVERSCROLL_DISTANCE && Math.abs(dx) > 2 * Math.abs(dy))
        onOverscroll();
    },
  });
  return {
    /** Where the lane's cards are (px, 0 or negative): the finger's while it drags. */
    offset: drag ?? 0,
    dragging: drag !== null,
    handlers,
    /** The click that ends a slide is not a tap. */
    onClickCapture: (event: { preventDefault: () => void; stopPropagation: () => void }) => {
      if (!consumesClick()) return;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
