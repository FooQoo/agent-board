import type { Epic, Project, ProjectId, Task, TaskSummary } from '../../../shared/api/contracts';
import { getJson, projectPath } from '../../../shared/api/http';
import { toTask, type WireTask } from '../../../shared/api/wire';

/** An archived card as the archive lists it: no text, conditions or history. Its Detail is read when it is opened. */
export type ArchivedTask = TaskSummary & { archivedAt?: string | null };

function archivedCard(task: Task): ArchivedTask {
  // The text, the log and the image list are read with the Detail when the card is opened.
  const { description, body, history, attachments, acceptance, ...card } = task;
  return {
    ...card,
    acceptance: { done: acceptance.filter((item) => item.done).length, total: acceptance.length },
  };
}

export interface ArchiveResponse {
  project: Project;
  version: string;
  cursor: string;
  /** The archived cards. Each card's epic is resolved against `epics` from the same response. */
  tasks: ArchivedTask[];
  /** The project's epics, read from the same snapshot as `tasks`. */
  epics: Epic[];
}

export async function fetchArchive(projectId: ProjectId): Promise<ArchiveResponse> {
  const wire = await getJson<Omit<ArchiveResponse, 'tasks'> & { tasks: WireTask[] }>(
    `${projectPath(projectId)}/archive`,
  );
  return { ...wire, tasks: wire.tasks.map((task) => archivedCard(toTask(task, wire.epics))) };
}
