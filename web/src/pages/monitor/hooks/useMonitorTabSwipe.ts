import { useRef } from 'react';
import { useSwipePages } from '@/shared/lib/gesture/useSwipePages';
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
  const carouselRef = useSwipePages(TAB_ORDER, tab, onTabChange, {
    ignore: (target, root) =>
      Boolean(window.getSelection()?.toString()) || shouldIgnoreTabSwipe(target, root),
    progressTarget: tabsRef,
    progressVar: '--tab-progress',
  });
  return { tabsRef, carouselRef };
}
