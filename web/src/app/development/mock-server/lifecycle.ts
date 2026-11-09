import type { Assignee, ColumnName, Task } from '../../../shared/api/contracts.ts';
import type { MockBoard } from './boards.ts';
import type { MockContext, MockResponse, Routes } from './types.ts';
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

const TASK_ROUTE = /^\/api\/projects\/([^/]+)\/(tasks(?:\/.*)?)$/;

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

  const taskMatch = /^tasks\/(\d+)\/(move|answer)$/.exec(rest);
  const creates = rest === 'tasks' || rest === 'tasks/multipart';
  if (!creates && !taskMatch) return null;
  if (!request.token) return forbidden();
  if (!found) return projectNotFound();
  // A form body arrives as the text of its `metadata` field; its images are not read.
  const input = parseBody(request.body);
  if (!input) return invalidJson();
  if (creates)
    return input.requestKind === 'simple'
      ? createTask(context, found, simpleRequest(found, input))
      : createTask(context, found, input);
  const id = Number(taskMatch?.[1]);
  const task = found.tasks.find((item) => item.id === id);
  if (!task) return error(404, 'task_not_found', `task #${id} not found.`, `No task has ID ${id}.`);
  return taskMatch?.[2] === 'move'
    ? moveTask(context, found, task, input)
    : answerTask(context, found, task, input);
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

/**
 * A simple request as the server reads it: an AI card whose title is the first line of the text
 * that is not blank, cut to the title limit, in the epic the request names.
 */
function simpleRequest(found: MockBoard, input: Record<string, unknown>): Record<string, unknown> {
  const description = String(input.description ?? '');
  const firstLine = description.split('\n').find((line) => line.trim() !== '') ?? '';
  const epic = found.epics.find((item) => item.id === input.epicId);
  return {
    title: [...firstLine.trim()].slice(0, TITLE_LIMIT).join(''),
    description,
    assignee: 'ai',
    epic: epic ? { id: epic.id, name: epic.name, color: epic.color } : null,
  };
}

function createTask(
  context: MockContext,
  found: MockBoard,
  input: Record<string, unknown>,
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
    isDraft: input.isDraft === true,
    archivedAt: null,
    history: [{ at, reason: 'Created task in Todo.' }],
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

function answerTask(
  context: MockContext,
  found: MockBoard,
  task: Task,
  input: Record<string, unknown>,
): MockResponse {
  if (task.agentStatus !== 'pending' || input.requestId !== task.pendingRequestId)
    return error(
      409,
      'request_changed',
      'the request has changed.',
      'Refresh the task and answer the current request.',
    );
  const choiceId = typeof input.choiceId === 'string' ? input.choiceId : undefined;
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (text.length > 2000)
    return error(
      422,
      'validation',
      'invalid text.',
      'An answer up to 2,000 characters is allowed.',
    );
  if (choiceId === undefined && text === '')
    return error(422, 'validation', 'answer_empty.', 'Choose an option or write an answer.');
  const choice =
    choiceId === undefined ? undefined : task.pendingChoices.find((item) => item.id === choiceId);
  if (choiceId !== undefined && !choice)
    return error(
      422,
      'request_choice_unknown',
      'the choice is not part of this request.',
      'Choose one of the options of the request.',
    );
  const at = context.now();
  const updated: Task = {
    ...task,
    agentStatus: 'idle',
    pendingReason: null,
    pendingRequestId: null,
    pendingChoices: [],
    updatedAt: at,
    agentStatusChangedAt: at,
    history: [...task.history, { at, reason: [choice?.label, text].filter(Boolean).join(' — ') }],
  };
  context.replaceTasks(found, [updated], [taskChangeOf(task, updated, ['summary', 'history'])]);
  return json(200, { task: updated, changed: true });
}
