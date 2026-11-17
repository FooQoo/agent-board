import type { Assignee, ColumnName, Task } from '../../../shared/api/contracts.ts';
import type { MockBoard } from './boards.ts';
import { answerQuestion } from './answers.ts';
import type { MockContext, MockResponse, RouteRequest, Routes } from './types.ts';
import {
  error,
  forbidden,
  invalidJson,
  json,
  noContent,
  parseBody,
  projectNotFound,
  taskChange,
  taskChangeOf,
} from './wire.ts';

// A card's life on the board: create, move, answer, archive, restore and delete.

const TASK_ROUTE = /^\/api\/projects\/([^/]+)\/(tasks(?:\/.*)?|messages\/(?:answers|requests))$/;

export const lifecycleRoutes: Routes = (context, request) => {
  const match = TASK_ROUTE.exec(request.url.pathname);
  if (!match || !['POST', 'DELETE'].includes(request.method)) return null;
  const projectId = match[1] ?? '';
  const rest = match[2] ?? '';
  const found = context.boards()[projectId];
  const post = request.method === 'POST';

  const deleteMatch = /^tasks\/(\d+)$/.exec(rest);
  if (!post && deleteMatch) {
    if (!request.token) return forbidden();
    if (!found) return projectNotFound();
    if (request.page.get('deleteFail') === '1')
      return error(
        500,
        'database_error',
        'cannot open the board.',
        'Mock failure (?deleteFail=1).',
      );
    const id = Number(deleteMatch[1]);
    if (!found.tasks.some((task) => task.id === id))
      return error(404, 'task_not_found', `task #${id} not found.`, `No task has ID ${id}.`);
    context.commit(projectId, { ...found, tasks: found.tasks.filter((task) => task.id !== id) }, [
      taskChange(id, ['deleted']),
    ]);
    return noContent();
  }
  if (!post) return null;

  const archiveMatch = /^tasks\/(\d+)\/(archive|restore)$/.exec(rest);
  if (archiveMatch) {
    if (!request.token) return forbidden();
    const id = Number(archiveMatch[1]);
    const task = found?.tasks.find((item) => item.id === id);
    if (!found || !task)
      return error(404, 'task_not_found', `task #${id} not found.`, 'Unknown ID.');
    const updated: Task = {
      ...task,
      archivedAt: archiveMatch[2] === 'archive' ? context.now() : null,
      agentStatus: 'idle',
      pendingReason: null,
      pendingRequestId: null,
    };
    context.replaceTasks(found, [updated], [taskChangeOf(task, updated, ['summary'])]);
    return json(200, { task: updated });
  }

  if (rest === 'tasks/archive-done') {
    if (!request.token) return forbidden();
    const input = parseBody(request.body);
    if (!input) return invalidJson();
    if (!found) return json(200, { tasks: [], archivedCount: 0 });
    return archiveDone(context, found, input);
  }

  if (rest === 'messages/answers') {
    if (!request.token) return forbidden();
    if (!found) return projectNotFound();
    const input = parseBody(request.body);
    if (!input) return invalidJson();
    return answerQuestion(context, found, input);
  }

  if (rest === 'messages/requests') {
    if (!request.token) return forbidden();
    if (!found) return projectNotFound();
    // The mock keeps no messages: it only accepts the request, as the server answers it.
    return json(201, {
      request: { id: 'Q-1', type: 'request', from: 'human', to: 'ai', status: 'open' },
    });
  }

  const taskMatch = /^tasks\/(\d+)\/move$/.exec(rest);
  const creates = rest === 'tasks' || rest === 'tasks/multipart';
  if (!creates && !taskMatch) return null;
  if (!request.token) return forbidden();
  if (!found) return projectNotFound();
  // A form body arrives as the text of its `metadata` field; its images are not read.
  const input = parseBody(request.body);
  if (!input) return invalidJson();
  if (creates) return createTask(context, found, input, request.language);
  const id = Number(taskMatch?.[1]);
  const task = found.tasks.find((item) => item.id === id);
  if (!task) return error(404, 'task_not_found', `task #${id} not found.`, `No task has ID ${id}.`);
  return moveTask(context, found, task, input);
};

function archiveDone(
  context: MockContext,
  found: MockBoard,
  input: Record<string, unknown>,
): MockResponse {
  const ids = new Set((Array.isArray(input.ids) ? input.ids : []).map(Number));
  const archivedAt = context.now();
  const archived = found.tasks
    .filter((item) => ids.has(item.id) && item.taskStatus === 'done' && !item.archivedAt)
    .map(
      (item): Task => ({
        ...item,
        archivedAt,
        agentStatus: 'idle',
        pendingReason: null,
        pendingRequestId: null,
      }),
    );
  const before = (id: number) => found.tasks.find((task) => task.id === id);
  context.replaceTasks(
    found,
    archived,
    archived.length > 0
      ? archived.map((item) => taskChangeOf(before(item.id), item, ['summary']))
      : [{ resource: 'project', id: found.project.id, facets: ['summary'] }],
  );
  return json(200, {
    tasks: found.tasks.filter((task) => ids.has(task.id)),
    archivedCount: archived.length,
  });
}

const TITLE_LIMIT = 100;

function createTask(
  context: MockContext,
  found: MockBoard,
  input: Record<string, unknown>,
  language: RouteRequest['language'],
): MockResponse {
  const title = String(input.title ?? '').trim();
  if (
    !title ||
    [...title].length > TITLE_LIMIT ||
    !['ai', 'human'].includes(String(input.assignee))
  )
    return error(422, 'validation', 'invalid task.', 'A title and assignee are required.');
  const at = context.now();
  const id = Math.max(0, ...found.tasks.map((task) => task.id)) + 1;
  const task: Task = {
    id,
    title,
    description: String(input.description ?? ''),
    body: '',
    acceptance: [],
    acceptanceError: false,
    assignee: input.assignee as Assignee,
    taskStatus: 'todo',
    taskStatusChangedAt: at,
    position: found.tasks.filter((item) => item.taskStatus === 'todo').length + 1,
    agentStatus: 'idle',
    pendingReason: null,
    pendingRequestId: null,
    pendingChoices: [],
    epic: (input.epic as Task['epic'] | undefined) ?? null,
    createdAt: at,
    updatedAt: at,
    agentStatusChangedAt: at,
    draft: input.draft === 'human' ? 'human' : null,
    archivedAt: null,
    // The page's language, as `agboard serve` writes the history of the cards it creates.
    history: [
      { at, reason: language === 'ja' ? 'タスクをTodoに作成しました。' : 'Created task in Todo.' },
    ],
    attachments: [],
  };
  context.commit(found.project.id, { ...found, tasks: [...found.tasks, task] }, [
    taskChange(id, ['summary']),
  ]);
  return json(201, { task });
}

function moveTask(
  context: MockContext,
  found: MockBoard,
  task: Task,
  input: Record<string, unknown>,
): MockResponse {
  const suppliedReason = String(input.reason ?? '');
  const reason = suppliedReason.trim()
    ? suppliedReason
    : `User changed the status from ${task.taskStatus} to ${String(input.taskStatus)}.`;
  if (reason.length > 2000)
    return error(
      422,
      'validation',
      'invalid reason.',
      'Use up to 2,000 characters for the reason.',
    );
  const target = String(input.taskStatus) as ColumnName;
  if (!['todo', 'doing', 'done'].includes(target) || target === task.taskStatus)
    return error(422, 'validation', 'invalid status.', 'Choose a different task status.');
  const at = context.now();
  const updated: Task = {
    ...task,
    taskStatus: target,
    taskStatusChangedAt: at,
    agentStatus: 'idle',
    pendingReason: null,
    pendingRequestId: null,
    updatedAt: at,
    agentStatusChangedAt: at,
    history: [...task.history, { at, reason }],
  };
  context.replaceTasks(found, [updated], [taskChangeOf(task, updated, ['summary', 'history'])]);
  return json(200, { task: updated, changed: true });
}
