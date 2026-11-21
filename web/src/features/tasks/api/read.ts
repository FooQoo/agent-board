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

/**
 * The archive list's order: newest `archivedAt` first, a card without a readable archive time after
 * all the others, and the higher id first when times are equal. The server sends this order; the page
 * applies it again so the list never depends on how the response was built.
 */
export function sortArchivedNewestFirst<T extends { id: number; archivedAt?: string | null }>(
  tasks: readonly T[],
): T[] {
  const time = (task: T) => (task.archivedAt ? Date.parse(task.archivedAt) : Number.NaN);
  return [...tasks].sort((a, b) => {
    const left = time(a);
    const right = time(b);
    const leftKnown = !Number.isNaN(left);
    const rightKnown = !Number.isNaN(right);
    if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
    if (leftKnown && left !== right) return right - left;
    return b.id - a.id;
  });
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
  return {
    ...wire,
    tasks: sortArchivedNewestFirst(
      wire.tasks.map((task) => archivedCard(toTask(task, wire.epics))),
    ),
  };
}
