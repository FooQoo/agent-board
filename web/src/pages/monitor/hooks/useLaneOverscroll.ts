import { type RefObject, useEffect, useRef } from 'react';
import { CHOSEN_CARD } from './useLaneCarousel';

/** How far (px) a swipe must go past the last lane to count. */
export const OVERSCROLL_DISTANCE = 72;
const KEEPS_ITS_SWIPE = `[data-lane-ignore],[data-swipe-action],${CHOSEN_CARD}`;

/**
 * A swipe to the left that starts while the last lane is on screen has no lane to go to. Past
 * `OVERSCROLL_DISTANCE`, and clearly sideways, it calls `onOverscroll` when the finger lifts. A
 * press on a chosen card, on its tiles or on a control marked `data-lane-ignore` keeps its own
 * swipe and is not read. Nothing is called while `enabled` is false.
 */
export function useLaneOverscroll(
  viewport: RefObject<HTMLElement | null>,
  enabled: boolean,
  onOverscroll: () => void,
) {
  const latest = useRef({ enabled, onOverscroll });
  latest.current = { enabled, onOverscroll };
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let start: { x: number; y: number } | null = null;
    const down = (event: PointerEvent) => {
      const target = event.target as Element | null;
      start =
        latest.current.enabled && event.isPrimary && !target?.closest(KEEPS_ITS_SWIPE)
          ? { x: event.clientX, y: event.clientY }
          : null;
    };
    const up = (event: PointerEvent) => {
      const from = start;
      start = null;
      if (!from) return;
      const dx = event.clientX - from.x;
      const dy = event.clientY - from.y;
      if (dx <= -OVERSCROLL_DISTANCE && Math.abs(dx) > 2 * Math.abs(dy))
        latest.current.onOverscroll();
    };
    const cancel = () => {
      start = null;
    };
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', cancel);
    return () => {
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', cancel);
    };
  }, [viewport]);
}
