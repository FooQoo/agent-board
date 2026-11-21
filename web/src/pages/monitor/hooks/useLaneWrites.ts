import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ColumnName, ProjectId } from '../../../shared/api/contracts';
import { TaskStatusChangedError } from '../../../features/tasks/api/lifecycle';
import type { MonitorTask, MonitorWrites } from '../contracts';
import type { useLaneOverlay } from './useLaneOverlay';

/**
 * What the lanes of the phone write: a move at once, an archive of one card, and the archive of the
 * whole Done lane. Each keeps the saved change on top of the lanes until a read shows it, and a
 * refused move says so in a notice.
 */
export function useLaneWrites({
  writes,
  projectId,
  overlay,
  doneItems,
  closePending,
  onWritten,
}: {
  writes: MonitorWrites | undefined;
  projectId: string;
  overlay: ReturnType<typeof useLaneOverlay>;
  doneItems: readonly MonitorTask[];
  closePending: () => void;
  onWritten?: () => void;
}) {
  const { t } = useTranslation();
  const [notice, setNotice] = useState<string | null>(null);
  const dismissNotice = useCallback(() => setNotice(null), []);
  // A move by a person is made at once, with no dialog. A task that moved meanwhile is not moved.
  const moveNow = async (item: MonitorTask, target: ColumnName) => {
    if (!writes) return;
    try {
      await writes.move(projectId as ProjectId, item.task.id, target, item.task.taskStatus);
      overlay.move(item.task.id, target);
    } catch (cause) {
      setNotice(
        cause instanceof TaskStatusChangedError
          ? t('moveNotice.statusChanged', { status: t(`column.${cause.current}`) })
          : t('moveNotice.failed'),
      );
    } finally {
      onWritten?.();
    }
  };
  const archiveOne = async (item: MonitorTask) => {
    try {
      await writes?.archive(projectId as ProjectId, item.task.id);
    } catch {
      return false;
    }
    overlay.hide([item.task.id]);
    closePending();
    onWritten?.();
    return true;
  };
  const archiveAll = async () => {
    try {
      const ids = doneItems.map((item) => item.task.id);
      await writes?.archiveDone(projectId as ProjectId, ids);
      overlay.hide(ids);
    } finally {
      onWritten?.();
    }
    closePending();
  };
  return { moveNow, archiveOne, archiveAll, notice, dismissNotice };
}
