import { useCallback, useRef } from 'react';
import { archiveTask, archiveDone, deleteTask, restoreTask } from '../api/lifecycle';
import type { OperationControls, OperationKind } from '../../../shared/lib/operations/operations';
import type { ProjectId } from '../../../shared/api/contracts';

export type TaskLifecycleAction = 'archive' | 'restore' | 'delete' | 'archive-done';
export type TaskLifecycleTarget = { taskId: number } | { taskIds: readonly number[] };
export type TaskLifecycleResult = { ok: true } | { ok: false; error: unknown };

function operationKind(action: TaskLifecycleAction): OperationKind {
  if (action === 'archive-done') return 'archive-done';
  return action;
}

/** Executes existing card APIs inside the project session's operation and duplicate-submit guard. */
export function useTaskLifecycle(operations: OperationControls) {
  const inFlight = useRef(false);

  const run = useCallback(
    async (
      action: TaskLifecycleAction,
      projectId: ProjectId,
      target: TaskLifecycleTarget,
      options: { keepOperationOnError?: boolean } = {},
    ): Promise<TaskLifecycleResult> => {
      if (inFlight.current)
        return { ok: false, error: new Error('An operation is already running.') };
      inFlight.current = true;
      const operationId = operations.begin(operationKind(action), projectId);
      if (operations.isCurrent && !operations.isCurrent(operationId, projectId)) {
        inFlight.current = false;
        return { ok: false, error: new Error('The project operation is no longer current.') };
      }
      operations.saveStarted(operationId);
      try {
        if (action === 'archive') {
          if (!('taskId' in target)) throw new Error('A card ID is required to archive a card.');
          await archiveTask(projectId, target.taskId);
        } else if (action === 'restore') {
          if (!('taskId' in target)) throw new Error('A card ID is required to restore a card.');
          await restoreTask(projectId, target.taskId);
        } else if (action === 'delete') {
          if (!('taskId' in target)) throw new Error('A card ID is required to delete a card.');
          const result = await deleteTask(projectId, target.taskId);
          if (result === 'failed') throw new Error('The card could not be deleted.');
        } else {
          if (!('taskIds' in target)) throw new Error('Task IDs are required for bulk archive.');
          await archiveDone(projectId, target.taskIds);
        }
        if (!operations.isCurrent || operations.isCurrent(operationId, projectId)) {
          if (action !== 'archive-done' && 'taskId' in target && operations.taskRemoved) {
            operations.taskRemoved(operationId, projectId, target.taskId);
          } else {
            operations.end(operationId);
          }
        }
        return { ok: true };
      } catch (error) {
        if (!operations.isCurrent || operations.isCurrent(operationId, projectId)) {
          operations.saveFailed(operationId);
          if (!options.keepOperationOnError) operations.end(operationId);
        }
        return { ok: false, error };
      } finally {
        inFlight.current = false;
      }
    },
    [operations],
  );

  return { run };
}
