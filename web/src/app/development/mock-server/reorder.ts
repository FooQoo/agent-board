import type { Task } from '../../../shared/api/contracts.ts';
import type { Routes } from './types.ts';
import {
  error,
  forbidden,
  invalidJson,
  json,
  parseBody,
  projectNotFound,
  taskChange,
  toWireTask,
} from './wire.ts';

// Dragging a card within its lane: the order of the lane, written as each card's position.

const REORDER_PATH = /^\/api\/projects\/([^/]+)\/tasks\/(\d+)\/reorder$/;

/**
 * The lane with `moved` placed before `beforeId`, or last when `beforeId` is null or not in the
 * lane, as `agboard serve` orders it: by position and ID, and from the bottom up in Done, where the
 * highest position is shown first.
 */
export function reorderedLane(tasks: Task[], moved: Task, beforeId: number | null): Task[] {
  const done = moved.taskStatus === 'done';
  const lane = tasks
    .filter((task) => task.taskStatus === moved.taskStatus && !task.archivedAt)
    .sort((a, b) => a.position - b.position || a.id - b.id);
  if (done) lane.reverse();
  const order = lane.filter((task) => task.id !== moved.id);
  const index = beforeId === null ? -1 : order.findIndex((task) => task.id === beforeId);
  order.splice(index === -1 ? order.length : index, 0, moved);
  return order
    .map((task, at) => ({ task, position: done ? order.length - at : at + 1 }))
    .filter(({ task, position }) => task.position !== position)
    .map(({ task, position }) => ({ ...task, position }));
}

/** `POST /api/projects/{id}/tasks/{n}/reorder` with `{beforeId}`; answers `{task, changed}`. */
export const reorderRoutes: Routes = (context, request) => {
  const match = request.method === 'POST' ? REORDER_PATH.exec(request.url.pathname) : null;
  if (!match) return null;
  if (!request.token) return forbidden();
  const found = context.boards()[match[1] ?? ''];
  if (!found) return projectNotFound();
  const id = Number(match[2]);
  const task = found.tasks.find((item) => item.id === id);
  if (!task) return error(404, 'task_not_found', `task #${id} not found.`, `No task has ID ${id}.`);
  const input = parseBody(request.body);
  if (!input) return invalidJson();
  const beforeId = input.beforeId ?? null;
  if (beforeId !== null && !Number.isInteger(beforeId))
    return error(422, 'validation', 'invalid beforeId.', 'Send beforeId as a task ID or null.');
  if (task.archivedAt)
    return error(
      409,
      'task_archived',
      `task #${id} is archived.`,
      'Restore the task before editing it.',
    );
  const updated = reorderedLane(found.tasks, task, beforeId as number | null);
  if (updated.length === 0) return json(200, { task: toWireTask(task), changed: false });
  context.replaceTasks(
    found,
    updated,
    updated.map((item) => taskChange(item.id, ['summary'])),
  );
  const after = updated.find((item) => item.id === id) ?? task;
  return json(200, { task: toWireTask(after), changed: true });
};
