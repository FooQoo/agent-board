import type { Task, ColumnName } from '../types';

/** Groups cards by column in display order: Todo and Doing oldest first, Done newest first. */
export function groupTasks(tasks: Task[]): Record<ColumnName, Task[]> {
  const groups: Record<ColumnName, Task[]> = { todo: [], doing: [], done: [] };
  for (const task of tasks) groups[task.taskStatus].push(task);
  groups.todo.sort((a, b) => a.position - b.position);
  groups.doing.sort((a, b) => a.position - b.position);
  groups.done.sort((a, b) => b.position - a.position);
  return groups;
}

export function findTask(tasks: Task[], id: number | null): Task | null {
  if (id === null) return null;
  return tasks.find((task) => task.id === id) ?? null;
}

/** Keeps the selection while the card exists; clears it once the card is gone. */
export function nextSelection(tasks: Task[], selectedId: number | null): number | null {
  return findTask(tasks, selectedId) ? selectedId : null;
}
