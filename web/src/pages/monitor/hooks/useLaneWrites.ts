import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ColumnName, ProjectId } from '../../../shared/api/contracts';
import { moveFailureNotice } from '../../../features/tasks/api/lifecycle';
import { useLaneMove } from '../../../features/tasks/useLaneMove';
import type { MonitorTask, MonitorWrites } from '../contracts';
import type { useLaneOverlay } from './useLaneOverlay';

/**
 * What the lanes of the phone write: a move at once, an archive of one card, and the archive of the
 * whole Done lane. A move stays on top of the lanes while its save is in flight and until a newer read
 * shows the project, and an archive until a read shows the card gone. A refused move says so in a notice.
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
  // A move by a person is made at once, with no dialog: the card shows in its new lane before the
  // server answers, and a refusal takes it back. A task that moved meanwhile is not moved.
  const move = useLaneMove({
    write: async (id, target, from) => {
      if (writes) await writes.move(projectId as ProjectId, id, target, from);
    },
    apply: overlay.move,
    settle: overlay.settle,
    revert: overlay.unmove,
    onDone: () => onWritten?.(),
    notify: setNotice,
    refusal: (cause) => moveFailureNotice(cause, t),
  });
  const moveNow = async (item: MonitorTask, target: ColumnName) => {
    if (!writes) return;
    await move(item.task.id, item.task.taskStatus, target);
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
