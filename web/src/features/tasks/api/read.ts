import type { Epic, Project, ProjectId, Task, TaskSummary } from '../../../shared/api/contracts';
import { getJson, projectPath } from '../../../shared/api/http';
import { toTask, type WireTask } from '../../../shared/api/wire';
import { compareArchivedNewestFirst } from './archiveOrder';

export { compareArchivedNewestFirst };

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

export function sortArchivedNewestFirst<T extends { id: number; archivedAt?: string | null }>(
  tasks: readonly T[],
): T[] {
  return [...tasks].sort(compareArchivedNewestFirst);
}

/** The archive as the screens hold it: the pages read so far, joined. */
export interface ArchiveResponse {
  project: Project;
  version: string;
  /** The archived cards read so far, newest first. Each card's epic is resolved against `epics`. */
  tasks: ArchivedTask[];
  /** The epics of the cards read so far. */
  epics: Epic[];
  /** How many archived tasks the project has, read with the newest page. */
  total: number;
}

/** One answer of `GET …/archive`. */
export interface ArchivePage extends ArchiveResponse {
  /** Where the next page starts, or `null` after the last page. */
  nextCursor: string | null;
}

export const ARCHIVE_PAGE_SIZE = 50;

/** Reads the page that starts after `cursor` (the first page when it is `null`). */
export async function fetchArchivePage(
  projectId: ProjectId,
  cursor: string | null,
  limit: number = ARCHIVE_PAGE_SIZE,
): Promise<ArchivePage> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor !== null) query.set('cursor', cursor);
  const wire = await getJson<Omit<ArchivePage, 'tasks'> & { tasks: WireTask[] }>(
    `${projectPath(projectId)}/archive?${query}`,
  );
  return {
    ...wire,
    tasks: sortArchivedNewestFirst(
      wire.tasks.map((task) => archivedCard(toTask(task, wire.epics))),
    ),
  };
}
