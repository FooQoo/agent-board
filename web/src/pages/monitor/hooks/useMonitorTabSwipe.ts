import { useRef } from 'react';
import { shouldIgnoreTabSwipe } from '@/shared/lib/gesture/tabSwipe';
import { useSwipePages } from '@/shared/lib/gesture/useSwipePages';
import type { MonitorDetailTab } from '../contracts';

export { shouldIgnoreTabSwipe };

export const TAB_ORDER: MonitorDetailTab[] = ['description', 'acceptance', 'history', 'epic'];

export function useMonitorTabSwipe(
  tab: MonitorDetailTab,
  onTabChange: (tab: MonitorDetailTab) => void,
) {
  const tabsRef = useRef<HTMLDivElement>(null);
  const carouselRef = useSwipePages(TAB_ORDER, tab, onTabChange, {
    ignore: (target, root) =>
      Boolean(window.getSelection()?.toString()) || shouldIgnoreTabSwipe(target, root),
    progressTarget: tabsRef,
    progressVar: '--tab-progress',
  });
  return { tabsRef, carouselRef };
}
