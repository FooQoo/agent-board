import { type RefObject, useEffect, useRef, useState } from 'react';
import useEmblaCarousel from 'embla-carousel-react';

export interface SwipePagesOptions {
  /**
   * Whether a press on `target` must not move the pages (a control, a text selection, an element
   * with a sideways swipe of its own). `root` is the viewport.
   */
  ignore?: (target: Element | null, root: HTMLElement) => boolean;
  /**
   * Where the slide's progress, from 0 (first page) to 1 (last), is written on every frame as the
   * CSS variable `progressVar`. A tab marker reads it to follow the finger without a render.
   */
  progressTarget?: RefObject<HTMLElement | null>;
  progressVar?: string;
  /**
   * When a swipe reports its page: `select` as soon as the page is decided (at the release), or
   * `settle` once the slide has stopped, so that drawing the new page does not stall the slide.
   */
  report?: 'select' | 'settle';
}

/**
 * Pages side by side, one on screen, moved by a sideways swipe or by `current` (Embla). The page on
 * screen belongs to the caller: a swipe reports it with `onChange`, and a new `current` slides to
 * it. The returned ref goes on the viewport, whose first child holds the pages.
 */
export function useSwipePages<Page extends string>(
  pages: readonly Page[],
  current: Page,
  onChange: (page: Page) => void,
  {
    ignore,
    progressTarget,
    progressVar = '--page-progress',
    report = 'select',
  }: SwipePagesOptions = {},
) {
  // Only the first page is an option: a changed option rebuilds the carousel, which would cut a
  // slide short. Later pages are reached with `scrollTo`.
  const [startIndex] = useState(() => Math.max(0, pages.indexOf(current)));
  // Embla keeps the first `watchDrag` it is given, so the test it runs is read from here.
  const ignoreRef = useRef(ignore);
  ignoreRef.current = ignore;
  const [viewportRef, carousel] = useEmblaCarousel({
    loop: false,
    watchFocus: false,
    startIndex,
    watchDrag: (api, event) => !ignoreRef.current?.(event.target as Element | null, api.rootNode()),
  });
  const ready = useRef<typeof carousel>(undefined);

  useEffect(() => {
    if (!carousel) return;
    const index = pages.indexOf(current);
    if (index >= 0 && carousel.selectedScrollSnap() !== index)
      carousel.scrollTo(index, ready.current !== carousel);
    ready.current = carousel;
  }, [carousel, pages, current]);

  useEffect(() => {
    if (!carousel) return;
    const reported = () => {
      const next = pages[carousel.selectedScrollSnap()];
      if (next !== undefined && next !== current) onChange(next);
    };
    carousel.on(report, reported);
    return () => {
      carousel.off(report, reported);
    };
  }, [carousel, pages, current, onChange, report]);

  useEffect(() => {
    if (!carousel || !progressTarget) return;
    const follow = () => {
      const progress = Math.max(0, Math.min(1, carousel.scrollProgress()));
      progressTarget.current?.style.setProperty(progressVar, String(progress));
    };
    follow();
    carousel.on('scroll', follow);
    carousel.on('reInit', follow);
    return () => {
      carousel.off('scroll', follow);
      carousel.off('reInit', follow);
    };
  }, [carousel, progressTarget, progressVar]);

  return viewportRef;
}
