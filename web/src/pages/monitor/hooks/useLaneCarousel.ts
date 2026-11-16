import { useEffect, useRef } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import type { MonitorSection } from '../components/MonitorSectionHeader';
import { LANES, laneIndex } from '../model/lanes';

/** A card that is chosen: its sideways moves slide it, not the lanes. */
export const CHOSEN_CARD = '[data-swipe-card][data-armed]';

/**
 * The lanes as a carousel: one lane on screen, a sideways swipe anywhere moves to the next. A swipe
 * that starts on a chosen card, on its tiles or on a control marked `data-lane-ignore` is left to
 * them. The lane on screen belongs to the caller, so the tabs and the swipe agree.
 */
export function useLaneCarousel(
  lane: MonitorSection,
  onLaneChange: (lane: MonitorSection) => void,
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
    const selected = () => {
      const next = LANES[carousel.selectedScrollSnap()];
      if (next && next !== lane) onLaneChange(next);
    };
    carousel.on('select', selected);
    return () => {
      carousel.off('select', selected);
    };
  }, [carousel, lane, onLaneChange]);

  return viewportRef;
}
