import { useCallback } from 'react';
import type { ProjectId } from '../../../shared/api/contracts';
import type { ArchiveSheetData } from '../components/ArchiveListSheet';
import type { MonitorWrites } from '../contracts';
import { fetchArchive } from '../../../features/tasks/api/read';
import { useProjectResource } from '../../../features/projects/model/useProjectResource';

/**
 * What the phone's archive list needs: the archive is read only while the list is open, and again
 * after each restore. Without writes there is nothing to restore, so the list is not offered.
 */
export function useArchiveSheet(
  open: boolean,
  projectId: string,
  writes: MonitorWrites | undefined,
  onWritten?: () => void,
): { archive?: ArchiveSheetData; onRestore?: (taskId: number) => Promise<void> } {
  const resource = useProjectResource(
    open && projectId ? (projectId as ProjectId) : null,
    fetchArchive,
  );
  const { reload } = resource;
  const restore = useCallback(
    async (taskId: number) => {
      if (!writes) return;
      try {
        await writes.restore(projectId, taskId);
      } finally {
        reload();
        onWritten?.();
      }
    },
    [writes, projectId, reload, onWritten],
  );
  if (!writes) return {};
  return {
    archive: {
      data: resource.data,
      status: resource.status,
      fetchFailed: resource.fetchFailed,
      onRetry: reload,
    },
    onRestore: restore,
  };
}
