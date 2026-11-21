import type { ProjectId, Task, TaskSummary } from '../../shared/api/contracts';
import { projectPath } from '../../shared/api/http';
import { postTask } from '../../shared/api/write';

/** Sends one Backlog card to Todo, as a person. `ack` confirms the warning about open questions. */
export function sendTask(projectId: ProjectId, id: number, ack: boolean) {
  return postTask<{ task: Task; changed: boolean }>(`${projectPath(projectId)}/tasks/${id}/send`, {
    ack,
  });
}

/** Sends the Backlog cards of an epic to Todo in one save. */
export function sendEpic(projectId: ProjectId, epicId: string, ack: boolean, taskIds?: number[]) {
  return postTask<{ sent: number[]; changed: boolean }>(
    `${projectPath(projectId)}/epics/${encodeURIComponent(epicId)}/send`,
    taskIds ? { taskIds, ack } : { ack },
  );
}

export interface SendOutcome {
  sent: number[];
  failed: number[];
}

/**
 * Sends the cards one after another. The server sends one card or one epic at a time, so a list of
 * cards from several epics is not one save: the ones that went are reported with the ones that did not.
 */
export async function sendTasks(
  projectId: ProjectId,
  ids: readonly number[],
  ack: boolean,
): Promise<SendOutcome> {
  const outcome: SendOutcome = { sent: [], failed: [] };
  for (const id of ids) {
    try {
      await sendTask(projectId, id, ack);
      outcome.sent.push(id);
    } catch {
      outcome.failed.push(id);
    }
  }
  return outcome;
}

/** Sends cards of one epic with the epic route: all of them in one save, or none. */
export async function sendEpicTasks(
  projectId: ProjectId,
  epicId: string,
  ids: readonly number[],
  ack: boolean,
): Promise<SendOutcome> {
  try {
    const { sent } = await sendEpic(projectId, epicId, ack, [...ids]);
    return { sent, failed: ids.filter((id) => !sent.includes(id)) };
  } catch {
    return { sent: [], failed: [...ids] };
  }
}

/** The cards among `ids` that still have an open question: sending them needs a confirmation. */
export function withOpenQuestions(tasks: readonly TaskSummary[], ids: readonly number[]) {
  return tasks.filter((task) => ids.includes(task.id) && (task.openQuestionIds?.length ?? 0) > 0);
}
