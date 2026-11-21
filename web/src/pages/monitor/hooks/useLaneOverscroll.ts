import { type RefObject, useState } from 'react';
import { cardOffset } from '@/shared/lib/gesture/cardReveal';
import { useSideSwipe } from '@/shared/lib/gesture/useSideSwipe';
import { actionsWidth } from '../model/lanes';
import { CHOSEN_CARD } from './useLaneCarousel';

/** How far (px) a swipe must go past the end lane to count. */
export const OVERSCROLL_DISTANCE = 72;
/** The room (px) the tile (Archive all, or Select all) takes while the lane follows the finger: one card tile. */
export const BULK_WIDTH = actionsWidth(1);
const KEEPS_ITS_SWIPE = `[data-lane-ignore],[data-swipe-action],${CHOSEN_CARD}`;

/**
 * A swipe that starts while an end lane is on screen and goes the way that has no lane: to the left
 * past the last lane (`direction` -1, the default, for Done) or to the right past the first
 * (`direction` 1, for the Backlog). While the finger is down the lane follows it (`offset`, negative
 * to the left) and uncovers a tile beside it, as a card does. Past `OVERSCROLL_DISTANCE`, and clearly
 * sideways, it calls `onOverscroll` when the finger lifts; either way the lane springs back. A press
 * on a chosen card, on its tiles or on a control marked `data-lane-ignore` keeps its own swipe and is
 * not read, and a move the other way is left to the lane carousel. Nothing is read while `enabled`
 * is false.
 */
export function useLaneOverscroll(
  lane: RefObject<HTMLElement | null>,
  enabled: boolean,
  onOverscroll: () => void,
  direction: -1 | 1 = -1,
) {
  const [drag, setDrag] = useState<number | null>(null);
  const { consumesClick, handlers } = useSideSwipe(lane, {
    active: enabled,
    disabled: !enabled,
    ignore: KEEPS_ITS_SWIPE,
    accepts: (dx) => dx * direction > 0 && !lane.current?.querySelector(CHOSEN_CARD),
    onSlide: (dx) =>
      setDrag(direction < 0 ? cardOffset(0, dx, 0, BULK_WIDTH) : cardOffset(0, dx, BULK_WIDTH, 0)),
    onRelease: (dx, _velocity, cancelled, dy) => {
      setDrag(null);
      if (!cancelled && dx * direction >= OVERSCROLL_DISTANCE && Math.abs(dx) > 2 * Math.abs(dy))
        onOverscroll();
    },
  });
  return {
    /** Where the lane's cards are (px, 0, or on the side of `direction`): the finger's while it drags. */
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
