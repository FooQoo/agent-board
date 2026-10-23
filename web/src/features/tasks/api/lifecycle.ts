import { i18n } from '../../../shared/i18n';
import type { ColumnName, ProjectId, Task } from '../../../shared/api/contracts';
import { projectPath, readToken } from '../../../shared/api/http';
import { postEmpty, postTask } from '../../../shared/api/write';
import { WriteError } from '../../../shared/api/writeErrors';

export function archiveTask(projectId: ProjectId, id: number) {
  return postEmpty(`${projectPath(projectId)}/tasks/${id}/archive`);
}

export function restoreTask(projectId: ProjectId, id: number) {
  return postEmpty(`${projectPath(projectId)}/tasks/${id}/restore`);
}

export async function archiveDone(projectId: ProjectId, ids: readonly number[]) {
  return postTask<{ tasks: Task[]; archivedCount: number }>(
    `${projectPath(projectId)}/tasks/archive-done`,
    { ids },
  );
}

/**
 * - `deleted`: the server answered 204.
 * - `not_found`: the card is already gone (404).
 * - `failed`: anything else, including network errors.
 */
export type DeleteResult = 'deleted' | 'not_found' | 'failed';

export async function deleteTask(projectId: ProjectId, id: number): Promise<DeleteResult> {
  try {
    const response = await fetch(`${projectPath(projectId)}/tasks/${id}`, {
      method: 'DELETE',
      headers: {
        'X-Agboard-Token': readToken(),
        'X-Agboard-Language': i18n.resolvedLanguage === 'ja' ? 'ja' : 'en',
      },
    });
    if (response.status === 204) return 'deleted';
    if (response.status === 404) return 'not_found';
    return 'failed';
  } catch {
    return 'failed';
  }
}

/** The task left the status the move started from; `current` is where it is now. */
export class TaskStatusChangedError extends Error {
  constructor(
    message: string,
    readonly current: ColumnName,
  ) {
    super(message);
  }
}

const COLUMNS: readonly ColumnName[] = ['todo', 'doing', 'done'];

/**
 * Moves a task. With `fromStatus` (the status the page showed), a task that has moved on since is
 * refused, nothing is written, and `TaskStatusChangedError` names its current status.
 */
export async function moveTask(
  projectId: ProjectId,
  id: number,
  taskStatus: ColumnName,
  reason: string,
  fromStatus?: ColumnName,
) {
  try {
    return await postTask<{ task: Task; changed: boolean }>(
      `${projectPath(projectId)}/tasks/${id}/move`,
      fromStatus === undefined ? { taskStatus, reason } : { taskStatus, reason, fromStatus },
    );
  } catch (cause) {
    const current = (cause instanceof WriteError ? cause.body : null) as {
      currentStatus?: unknown;
    } | null;
    if (
      cause instanceof WriteError &&
      cause.code === 'task_status_changed' &&
      COLUMNS.includes(current?.currentStatus as ColumnName)
    )
      throw new TaskStatusChangedError(cause.message, current?.currentStatus as ColumnName);
    throw cause;
  }
}

/** Puts a card just before `beforeId` in its lane, or at the end of the lane when `beforeId` is null. */
export async function reorderTask(projectId: ProjectId, id: number, beforeId: number | null) {
  return postTask<{ task: Task; changed: boolean }>(
    `${projectPath(projectId)}/tasks/${id}/reorder`,
    { beforeId },
  );
}
