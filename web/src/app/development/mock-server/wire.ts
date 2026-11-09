import type { Board, EpicTaskCounts, Task } from '../../../shared/api/contracts.ts';
import type { Change, Facet } from '../../../shared/data/api/contracts.ts';
import type { MockBoard } from './boards.ts';
import type { MockResponse } from './types.ts';

// Answers, and the wire shapes the server writes, for the routes of the sample-data server.

const NO_STORE = { 'Cache-Control': 'no-store' };

export function json(status: number, body: unknown): MockResponse {
  return {
    kind: 'response',
    status,
    headers: { 'Content-Type': 'application/json', ...NO_STORE },
    body: JSON.stringify(body),
  };
}

export const ndjsonResponse = (body: string): MockResponse => ({
  kind: 'response',
  status: 200,
  headers: { 'Content-Type': 'application/x-ndjson', ...NO_STORE },
  body,
});

export function error(status: number, code: string, message: string, reason: string) {
  return json(status, { error: { code, message, reason } });
}

export const noContent = (): MockResponse => ({
  kind: 'response',
  status: 204,
  headers: {},
  body: '',
});
export const projectNotFound = () =>
  error(404, 'project_not_found', 'project not found.', 'Unknown ID.');
export const forbidden = () =>
  error(403, 'forbidden', 'request refused.', 'Missing X-Agboard-Token header.');
export const invalidJson = () =>
  error(400, 'invalid_json', 'invalid request.', 'The request body must be JSON.');

/** The body as a JSON object, or null when it is not JSON. An empty body is `{}`. */
export function parseBody(text: string | undefined): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text || '{}');
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    return null;
  }
}

function versionOf(board: MockBoard): string {
  return `mock-${board.revision}`;
}

/** A card as the server writes it: the epic is an ID that the board resolves against `epics`. */
export function toWireTask({ epic, ...task }: Task) {
  return { ...task, epicId: epic?.id ?? null };
}

/** How many of each epic's tasks are in each lane, with the archived ones counted apart. */
function epicCounts(board: MockBoard): Record<string, EpicTaskCounts> {
  const counts: Record<string, EpicTaskCounts> = {};
  for (const epic of board.epics) {
    counts[epic.id] = { todo: 0, doing: 0, done: 0, archived: 0, total: 0 };
  }
  for (const task of board.tasks) {
    const entry = task.epic ? counts[task.epic.id] : undefined;
    if (!entry) continue;
    entry[task.archivedAt ? 'archived' : task.taskStatus] += 1;
    entry.total += 1;
  }
  return counts;
}

/** The project's parts in the wire shape the server writes: cards with their epic IDs, the epics and the problems. */
export function wireBoard(board: MockBoard, tasks: Task[]) {
  return {
    project: board.project,
    version: versionOf(board),
    cursor: `f1:${board.project.id}:${versionOf(board)}`,
    epics: board.epics,
    epicTaskCounts: epicCounts(board),
    tasks: tasks.map(toWireTask),
    problems: board.problems,
  };
}

/** The board as the Summary and the Detail streams are made from it. */
export function boardView(board: MockBoard, tasks: Task[]): Board {
  const wire = wireBoard(board, tasks);
  return { ...wire, tasks };
}

export const taskMarkdown = (
  body: string,
  acceptance: Task['acceptance'],
  history: Task['history'],
) =>
  `---\nacceptance: ${JSON.stringify(acceptance)}\nhistory: ${JSON.stringify(history)}\n---\n\n${body}`;

export const taskChange = (id: number, facets: Facet[]): Change => ({
  resource: 'task',
  id,
  facets,
});

/** A task change, with `request` added when the task's decision request was asked or settled. */
export function taskChangeOf(before: Task | undefined, after: Task, facets: Facet[]): Change {
  const requestChanged = (before?.pendingRequestId ?? null) !== after.pendingRequestId;
  return taskChange(after.id, requestChanged ? [...facets, 'request'] : facets);
}
