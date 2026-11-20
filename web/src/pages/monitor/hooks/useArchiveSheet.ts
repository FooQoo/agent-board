import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProjectId } from '../../../shared/api/contracts';
import type { ArchiveSheetData } from '../components/ArchiveListSheet';
import type { MonitorWrites } from '../contracts';
import { fetchArchive } from '../../../features/tasks/api/read';
import { useProjectResource } from '../../../features/projects/model/useProjectResource';

/**
 * What the phone's archive list needs: the archive is read once each time the list opens. A restored
 * task leaves the list at once and the archive is not read again; closing the list forgets which
 * tasks were restored, so the next opening reads fresh. Without writes there is nothing to restore, so the list is not offered.
 */
export function useArchiveSheet(
  open: boolean,
  projectId: string,
  writes: MonitorWrites | undefined,
  onWritten?: () => void,
  onRestored?: (taskId: number) => void,
): { archive?: ArchiveSheetData; onRestore?: (taskId: number) => Promise<void> } {
  const resource = useProjectResource(
    open && projectId ? (projectId as ProjectId) : null,
    fetchArchive,
  );
  const { reload } = resource;
  const [restored, setRestored] = useState<ReadonlySet<number>>(() => new Set());
  useEffect(() => {
    if (!open) setRestored((current) => (current.size === 0 ? current : new Set()));
  }, [open]);
  const source = resource.data;
  const data = useMemo(
    () =>
      source && restored.size > 0
        ? { ...source, tasks: source.tasks.filter((task) => !restored.has(task.id)) }
        : source,
    [source, restored],
  );
  const restore = useCallback(
    async (taskId: number) => {
      if (!writes) return;
      try {
        await writes.restore(projectId, taskId);
        setRestored((current) => new Set(current).add(taskId));
        onRestored?.(taskId);
      } finally {
        onWritten?.();
      }
    },
    [writes, projectId, onWritten, onRestored],
  );
  if (!writes) return {};
  return {
    archive: {
      data,
      status: resource.status,
      fetchFailed: resource.fetchFailed,
      onRetry: reload,
    },
    onRestore: restore,
  };
}
