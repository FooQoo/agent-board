import type { ColumnName, TaskSummary } from '../../../shared/api/contracts';

/** Groups cards by column in display order: Todo and Doing oldest first, Done newest first. */
export function groupTasks<T extends TaskSummary>(tasks: T[]): Record<ColumnName, T[]> {
  const groups: Record<ColumnName, T[]> = { todo: [], doing: [], done: [] };
  for (const task of tasks) groups[task.taskStatus].push(task);
  groups.todo.sort((a, b) => a.position - b.position);
  groups.doing.sort((a, b) => a.position - b.position);
  groups.done.sort((a, b) => b.position - a.position);
  return groups;
}

export function findTask<T extends { id: number }>(tasks: T[], id: number | null): T | null {
  if (id === null) return null;
  return tasks.find((task) => task.id === id) ?? null;
}

/** Keeps the selection while the card exists; clears it once the card is gone. */
export function nextSelection(tasks: { id: number }[], selectedId: number | null): number | null {
  return findTask(tasks, selectedId) ? selectedId : null;
}
