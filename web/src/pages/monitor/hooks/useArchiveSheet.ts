import { useCallback } from 'react';
import type { ProjectId } from '../../../shared/api/contracts';
import type { ArchiveSheetData } from '../components/ArchiveListSheet';
import type { MonitorWrites } from '../contracts';
import { useArchivePages } from '../../../features/tasks/model/useArchivePages';

/**
 * What the phone's archive list needs: the archive is read a page at a time each time the list
 * opens, and the next page is read as the list scrolls. A restored task leaves the list at once and
 * the archive is not read again; closing the list forgets what was read, so the next opening reads
 * fresh. Without writes there is nothing to restore, so the list is not offered.
 */
export function useArchiveSheet(
  open: boolean,
  projectId: string,
  writes: MonitorWrites | undefined,
  onWritten?: () => void,
  onRestored?: (taskId: number) => void,
): { archive?: ArchiveSheetData; onRestore?: (taskId: number) => Promise<void> } {
  const pages = useArchivePages(open && projectId ? (projectId as ProjectId) : null);
  const { remove } = pages;
  const restore = useCallback(
    async (taskId: number) => {
      if (!writes) return;
      try {
        await writes.restore(projectId, taskId);
        remove(taskId);
        onRestored?.(taskId);
      } finally {
        onWritten?.();
      }
    },
    [writes, projectId, onWritten, onRestored, remove],
  );
  if (!writes) return {};
  return {
    archive: {
      data: pages.data,
      status: pages.status,
      fetchFailed: pages.fetchFailed,
      onRetry: pages.reload,
      hasMore: pages.hasMore,
      loadingMore: pages.loadingMore,
      loadMoreFailed: pages.loadMoreFailed,
      loadMore: pages.loadMore,
      retryMore: pages.retryMore,
    },
    onRestore: restore,
  };
}
