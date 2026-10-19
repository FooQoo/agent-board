import type { Board, Epic, ProjectId, Task } from '../../../shared/api/contracts';
import { getJson, projectPath } from '../../../shared/api/http';
import { toBoard, toTask, type WireBoard, type WireTask } from '../../../shared/api/wire';

export async function fetchBoard(projectId: ProjectId): Promise<Board> {
  return toBoard(await getJson<WireBoard>(`${projectPath(projectId)}/board`));
}

export interface ArchiveResponse {
  project: Board['project'];
  version: string;
  cursor: string;
  /** The archived cards. Each card's epic is resolved against `epics` from the same response. */
  tasks: Task[];
  /** The project's epics, read from the same snapshot as `tasks`. */
  epics: Epic[];
}

export async function fetchArchive(projectId: ProjectId): Promise<ArchiveResponse> {
  const wire = await getJson<Omit<ArchiveResponse, 'tasks'> & { tasks: WireTask[] }>(
    `${projectPath(projectId)}/archive`,
  );
  return { ...wire, tasks: wire.tasks.map((task) => toTask(task, wire.epics)) };
}
