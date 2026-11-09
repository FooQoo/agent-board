import type { Epic, Task } from '../../../shared/api/contracts.ts';
import type { Facet } from '../../../shared/data/api/contracts.ts';
import type { MockBoard } from './boards.ts';
import type { MockContext, MockResponse, RouteRequest, Routes } from './types.ts';
import {
  error,
  invalidJson,
  json,
  parseBody,
  projectNotFound,
  taskChange,
  taskMarkdown,
  toWireTask,
} from './wire.ts';

// The epic and card writes of the editing dialogs: edit, epic, draft and membership.

const EPIC_PATH = /^\/api\/projects\/([^/]+)\/epics\/([^/]+)(\/attachments(?:\/[^/]+)?)?$/;
const TASK_PATH = /^\/api\/projects\/([^/]+)\/tasks\/(\d+)(\/multipart|\/draft|\/epic)?$/;

export const editRoutes: Routes = (context, request) => {
  const { method } = request;
  const path = request.url.pathname;
  const epicPath = EPIC_PATH.exec(path);
  if (epicPath && ['PATCH', 'POST', 'DELETE'].includes(method)) {
    const target = context.boards()[epicPath[1] ?? ''];
    if (!target) return projectNotFound();
    return editEpic(context, request, target, decodeURIComponent(epicPath[2] ?? ''), epicPath[3]);
  }
  const taskPath = TASK_PATH.exec(path);
  if (taskPath && ['PATCH', 'PUT'].includes(method)) {
    const target = context.boards()[taskPath[1] ?? ''];
    if (!target) return projectNotFound();
    return editTask(context, request, target, Number(taskPath[2]), taskPath[3] ?? '');
  }
  return null;
};

function editEpic(
  context: MockContext,
  request: RouteRequest,
  target: MockBoard,
  epicId: string,
  attachments: string | undefined,
): MockResponse {
  const epic = target.epics.find((item) => item.id === epicId);
  if (!epic) return error(404, 'epic_not_found', 'epic not found.', 'Unknown ID.');
  // Images: the mock leaves the form body alone and answers with the epic as it is.
  if (attachments) return json(200, { epic });
  const patch = request.method === 'PATCH' ? parseBody(request.body) : {};
  if (!patch) return invalidJson();
  const next: Epic = {
    ...epic,
    name: typeof patch.name === 'string' ? patch.name : epic.name,
    color: typeof patch.color === 'string' ? patch.color : epic.color,
    isDraft: typeof patch.isDraft === 'boolean' ? patch.isDraft : epic.isDraft,
    document: typeof patch.document === 'string' ? patch.document : epic.document,
  };
  context.commit(
    target.project.id,
    { ...target, epics: target.epics.map((item) => (item.id === epicId ? next : item)) },
    [{ resource: 'epic', id: epicId, facets: ['summary', 'document'] }],
  );
  return json(200, { epic: next, changed: true });
}

function editTask(
  context: MockContext,
  request: RouteRequest,
  target: MockBoard,
  taskId: number,
  suffix: string,
): MockResponse {
  const task = target.tasks.find((item) => item.id === taskId);
  if (!task) return error(404, 'task_not_found', 'task not found.', 'Unknown ID.');
  let next: Task = task;
  let facets: Facet[] = ['summary'];
  if (suffix === '/draft' || suffix === '/epic') {
    const input = parseBody(request.body);
    if (!input) return invalidJson();
    if (suffix === '/draft') {
      next = { ...task, isDraft: Boolean(input.isDraft) };
    } else {
      const epicId = typeof input.epicId === 'string' ? input.epicId : null;
      const epic = epicId ? target.epics.find((item) => item.id === epicId) : undefined;
      next = { ...task, epic: epic ? { id: epic.id, name: epic.name, color: epic.color } : null };
    }
  } else if (suffix === '/multipart') {
    // The form body (text and images) is not read: the card stays as it is.
    facets = ['summary', 'document'];
  } else {
    const input = request.method === 'PATCH' ? parseBody(request.body) : {};
    if (!input) return invalidJson();
    next = editedTask(task, input, context.now());
    facets = ['summary', 'document', 'history'];
  }
  context.replaceTasks(target, [next], [taskChange(taskId, facets)]);
  return json(200, { task: toWireTask(next), changed: true });
}

/** The card after the edit dialog's `PATCH`: title, body and acceptance, and `finalize`. */
function editedTask(task: Task, input: Record<string, unknown>, at: string): Task {
  const history =
    input.finalize === true && task.isDraft
      ? [...task.history, { at, reason: 'Finalized the draft.' }]
      : task.history;
  const editedBody = typeof input.body === 'string' ? input.body : task.body;
  const editedAcceptance = Array.isArray(input.acceptance)
    ? (input.acceptance as Task['acceptance'])
    : task.acceptance;
  const documentChanged =
    typeof input.description === 'string' ||
    typeof input.body === 'string' ||
    Array.isArray(input.acceptance);
  return {
    ...task,
    ...(typeof input.title === 'string' ? { title: input.title } : {}),
    ...(documentChanged
      ? {
          body: editedBody,
          acceptance: editedAcceptance,
          description: taskMarkdown(editedBody, editedAcceptance, history),
        }
      : {}),
    history,
    ...(input.finalize === true ? { isDraft: false } : {}),
  };
}
