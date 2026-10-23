import { useEffect, useRef } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import type { MonitorDetailTab } from '../contracts';

export const TAB_ORDER: MonitorDetailTab[] = ['description', 'acceptance', 'history', 'epic'];

export function shouldIgnoreTabSwipe(target: EventTarget | null, panel: HTMLElement): boolean {
  if (!(target instanceof Element)) return false;
  const targetDialog = target.closest('[role="dialog"]');
  const panelDialog = panel.closest('[role="dialog"]');
  if (targetDialog && targetDialog !== panelDialog) return true;
  if (
    target.closest(
      'button, a, input, textarea, select, summary, [contenteditable="true"], [data-no-tab-swipe], table, pre, code, img, picture, figure, .lightbox, .mermaid, .diagram',
    )
  )
    return true;
  let node: Element | null = target;
  while (node && node !== panel) {
    const style = getComputedStyle(node);
    if (
      (style.overflowX === 'auto' || style.overflowX === 'scroll') &&
      node.scrollWidth > node.clientWidth + 1
    )
      return true;
    node = node.parentElement;
  }
  return false;
}

export function useMonitorTabSwipe(
  tab: MonitorDetailTab,
  onTabChange: (tab: MonitorDetailTab) => void,
) {
  const tabsRef = useRef<HTMLDivElement>(null);
  const [carouselRef, carousel] = useEmblaCarousel({
    loop: false,
    watchFocus: false,
    watchDrag: (api, event) =>
      !window.getSelection()?.toString() && !shouldIgnoreTabSwipe(event.target, api.rootNode()),
  });
  const initializedCarousel = useRef<typeof carousel>(undefined);

  useEffect(() => {
    if (!carousel) return;
    const index = TAB_ORDER.indexOf(tab);
    if (initializedCarousel.current !== carousel || carousel.selectedScrollSnap() !== index) {
      carousel.scrollTo(index, initializedCarousel.current !== carousel);
    }
    initializedCarousel.current = carousel;
  }, [carousel, tab]);

  useEffect(() => {
    if (!carousel) return;
    const onSelected = () => {
      const next = TAB_ORDER[carousel.selectedScrollSnap()];
      if (next && next !== tab) onTabChange(next);
    };
    const updateIndicator = () => {
      const progress = Math.max(0, Math.min(1, carousel.scrollProgress()));
      tabsRef.current?.style.setProperty('--tab-progress', String(progress));
    };
    updateIndicator();
    carousel.on('select', onSelected);
    carousel.on('scroll', updateIndicator);
    carousel.on('reInit', updateIndicator);
    return () => {
      carousel.off('select', onSelected);
      carousel.off('scroll', updateIndicator);
      carousel.off('reInit', updateIndicator);
    };
  }, [carousel, tab, onTabChange]);

  return { tabsRef, carouselRef };
}
