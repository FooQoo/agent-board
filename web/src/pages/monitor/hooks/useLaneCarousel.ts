import { type RefObject, useEffect, useRef } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import type { MonitorSection } from '../components/MonitorSectionHeader';
import { LANES, laneIndex } from '../model/lanes';

/** A card that is chosen: its sideways moves slide it, not the lanes. */
export const CHOSEN_CARD = '[data-swipe-card][data-armed]';

/**
 * The lanes as a carousel: one lane on screen, a sideways swipe anywhere moves to the next. A swipe
 * that starts on a chosen card, on its tiles or on a control marked `data-lane-ignore` is left to
 * them. The lane on screen belongs to the caller, so the tabs and the swipe agree.
 *
 * As in the detail drawer, the tabs follow the finger: `--lane-progress` (0 to 1) is written on
 * `progressTarget` on every frame of the slide, without a render. The new lane reaches React only
 * once the slide has stopped, so drawing it does not stall the slide.
 */
export function useLaneCarousel(
  lane: MonitorSection,
  onLaneChange: (lane: MonitorSection) => void,
  progressTarget?: RefObject<HTMLElement | null>,
) {
  const [viewportRef, carousel] = useEmblaCarousel({
    loop: false,
    watchFocus: false,
    startIndex: laneIndex(lane),
    watchDrag: (_api, event) =>
      !(event.target as Element | null)?.closest(
        `[data-lane-ignore],[data-swipe-action],${CHOSEN_CARD}`,
      ),
  });
  const ready = useRef<typeof carousel>(undefined);

  useEffect(() => {
    if (!carousel) return;
    const index = laneIndex(lane);
    if (carousel.selectedScrollSnap() !== index)
      carousel.scrollTo(index, ready.current !== carousel);
    ready.current = carousel;
  }, [carousel, lane]);

  useEffect(() => {
    if (!carousel) return;
    const settled = () => {
      const next = LANES[carousel.selectedScrollSnap()];
      if (next && next !== lane) onLaneChange(next);
    };
    carousel.on('settle', settled);
    return () => {
      carousel.off('settle', settled);
    };
  }, [carousel, lane, onLaneChange]);

  useEffect(() => {
    if (!carousel) return;
    const follow = () => {
      const progress = Math.max(0, Math.min(1, carousel.scrollProgress()));
      progressTarget?.current?.style.setProperty('--lane-progress', String(progress));
    };
    follow();
    carousel.on('scroll', follow);
    carousel.on('reInit', follow);
    return () => {
      carousel.off('scroll', follow);
      carousel.off('reInit', follow);
    };
  }, [carousel, progressTarget]);

  return viewportRef;
}
