import { i18n } from '../../../shared/i18n';
import type { ColumnName, ProjectId, Task } from '../../../shared/api/contracts';
import { projectPath, readToken } from '../../../shared/api/http';
import { postEmpty, postTask } from '../../../shared/api/write';

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

export async function moveTask(
  projectId: ProjectId,
  id: number,
  taskStatus: ColumnName,
  reason: string,
) {
  return postTask<{ task: Task; changed: boolean }>(`${projectPath(projectId)}/tasks/${id}/move`, {
    taskStatus,
    reason,
  });
}

/** Puts a card just before `beforeId` in its lane, or at the end of the lane when `beforeId` is null. */
export async function reorderTask(projectId: ProjectId, id: number, beforeId: number | null) {
  return postTask<{ task: Task; changed: boolean }>(
    `${projectPath(projectId)}/tasks/${id}/reorder`,
    { beforeId },
  );
}
