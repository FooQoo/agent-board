import type { Task } from '../../../shared/api/contracts.ts';
import { inferLanguage } from './completion.ts';
import type { Routes } from './types.ts';
import {
  error,
  forbidden,
  invalidJson,
  json,
  parseBody,
  projectNotFound,
  taskChange,
  taskMarkdown,
  toWireTask,
} from './wire.ts';

// A person checking or unchecking one acceptance condition, from the board or the mobile monitor.

const ACCEPTANCE_PATH = /^\/api\/projects\/([^/]+)\/tasks\/(\d+)\/acceptance\/([^/]+)$/;

const MARKED = {
  en: (condition: string, done: boolean) =>
    `A person marked ${condition} as ${done ? 'met' : 'not met'}.`,
  ja: (condition: string, done: boolean) =>
    done
      ? `ユーザーが${condition}を達成にしました。`
      : `ユーザーが${condition}を未達成に戻しました。`,
};

/**
 * `PUT /api/projects/{id}/tasks/{n}/acceptance/{conditionId}` with `{done}`. The answer is the task
 * as the change left it; when that meets every condition, the server's automatic Done follows as
 * its own change.
 */
export const acceptanceRoutes: Routes = (context, request) => {
  const match = request.method === 'PUT' ? ACCEPTANCE_PATH.exec(request.url.pathname) : null;
  if (!match) return null;
  if (!request.token) return forbidden();
  const found = context.boards()[match[1] ?? ''];
  if (!found) return projectNotFound();
  const id = Number(match[2]);
  const condition = decodeURIComponent(match[3] ?? '');
  const task = found.tasks.find((item) => item.id === id);
  if (!task) return error(404, 'task_not_found', `task #${id} not found.`, `No task has ID ${id}.`);
  const input = parseBody(request.body);
  if (!input) return invalidJson();
  if (typeof input.done !== 'boolean')
    return error(422, 'validation', 'invalid acceptance.', 'Send done as true or false.');
  if (task.archivedAt)
    return error(
      409,
      'task_archived',
      `task #${id} is archived.`,
      'Restore the task before editing it.',
    );
  if (task.acceptanceError)
    return error(
      422,
      'file_invalid',
      `tasks/${id}/TASK.md is not valid.`,
      'The acceptance conditions cannot be read.',
    );
  const item = task.acceptance.find((entry) => entry.id === condition);
  if (!item)
    return error(
      422,
      'invalid_argument',
      `Task #${id} has no acceptance condition ${condition}.`,
      'Run "agboard --help" for usage.',
    );
  if (item.done === input.done) return json(200, { task: toWireTask(task), changed: false });

  const at = context.now();
  const language = request.language ?? inferLanguage(task);
  const acceptance = task.acceptance.map((entry) =>
    entry.id === condition ? { ...entry, done: input.done as boolean } : entry,
  );
  const history = [...task.history, { at, reason: MARKED[language](condition, input.done) }];
  const updated: Task = {
    ...task,
    acceptance,
    history,
    description: taskMarkdown(task.body, acceptance, history),
    updatedAt: at,
  };
  context.replaceTasks(found, [updated], [taskChange(id, ['summary', 'document', 'history'])]);
  return json(200, { task: toWireTask(updated), changed: true });
};
