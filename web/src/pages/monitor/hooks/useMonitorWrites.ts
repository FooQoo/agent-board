import { useTranslation } from 'react-i18next';
import type { ProjectId, Task } from '../../../shared/api/contracts';
import { moveFailureNotice } from '../../../features/tasks/api/lifecycle';
import { useBacklogMove } from '../../../features/backlog/useBacklogMove';
import { useBacklogSend } from '../../../features/backlog/useBacklogSend';
import { useLaneWrites } from './useLaneWrites';

type LaneWritesInput = Parameters<typeof useLaneWrites>[0];

/**
 * The phone board's writes in one place: the picked Backlog cards' send, the single Backlog card
 * moved by its swipe tile (a normal lane move, kept apart from the send), and the other lane writes.
 */
export function useMonitorWrites(input: LaneWritesInput & { tasks: readonly Task[] }) {
  const { t } = useTranslation();
  const { writes, projectId, overlay, onWritten, tasks } = input;
  const project = writes ? (projectId as ProjectId) : null;
  const backlogSend = useBacklogSend(project, [...tasks], () => onWritten?.());
  const backlogMove = useBacklogMove(project, [...tasks], {
    apply: overlay.move,
    settle: overlay.settle,
    revert: overlay.unmove,
    onDone: () => onWritten?.(),
    refusal: (cause) => moveFailureNotice(cause, t),
  });
  const lane = useLaneWrites(input);
  return { backlogSend, backlogMove, ...lane };
}
