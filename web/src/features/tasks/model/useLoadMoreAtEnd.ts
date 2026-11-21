import { observeElementRect } from '@tanstack/react-virtual';
import type { Rect, Virtualizer } from '@tanstack/react-virtual';
import { useEffect } from 'react';
import type { ArchivePages } from './useArchivePages';

/** What a scroller that reports no height (jsdom, a hidden box) is taken to be, so rows still draw. */
export const FALLBACK_HEIGHT = 800;

/** `observeElementRect` for a virtualizer, with a height for a scroller that reports none. */
export function observeRectWithFallback(
  instance: Virtualizer<HTMLElement, Element>,
  cb: (rect: Rect) => void,
) {
  return observeElementRect(instance, (rect) =>
    cb(rect.height > 0 ? rect : { ...rect, height: FALLBACK_HEIGHT }),
  );
}

/**
 * Asks for the next page when the last row is inside the virtualizer's rendered range (its
 * overscan included). A failed request waits for `retryMore` instead of asking again by itself.
 */
export function useLoadMoreAtEnd(
  lastRenderedIndex: number | undefined,
  rowCount: number,
  pages: Pick<ArchivePages, 'hasMore' | 'loadingMore' | 'loadMoreFailed' | 'loadMore'>,
): void {
  const { hasMore, loadingMore, loadMoreFailed, loadMore } = pages;
  useEffect(() => {
    if (lastRenderedIndex === undefined || rowCount === 0) return;
    if (lastRenderedIndex < rowCount - 1) return;
    if (hasMore && !loadingMore && !loadMoreFailed) loadMore();
  }, [lastRenderedIndex, rowCount, hasMore, loadingMore, loadMoreFailed, loadMore]);
}
