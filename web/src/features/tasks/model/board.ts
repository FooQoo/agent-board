import type { ColumnName, TaskSummary } from '../../../shared/api/contracts';

/**
 * The first-run guide's sample cards lead their lane, in their order, so the guide's frame at the
 * top of the lane shows them where they are, on a board that already has cards.
 */
function samplesFirst<T extends TaskSummary>(byPosition: (a: T, b: T) => number) {
  return (a: T, b: T): number => {
    const left = a.onboardingSample?.ordinal;
    const right = b.onboardingSample?.ordinal;
    if (left !== undefined && right !== undefined) return left - right;
    if (left !== undefined) return -1;
    if (right !== undefined) return 1;
    return byPosition(a, b);
  };
}

/**
 * Groups cards by column in display order: Todo and Doing oldest first, Done newest first. The
 * guide's sample cards come first in their lane.
 */
export function groupTasks<T extends TaskSummary>(tasks: T[]): Record<ColumnName, T[]> {
  const groups: Record<ColumnName, T[]> = { todo: [], doing: [], done: [] };
  for (const task of tasks) groups[task.taskStatus].push(task);
  groups.todo.sort(samplesFirst((a, b) => a.position - b.position));
  groups.doing.sort(samplesFirst((a, b) => a.position - b.position));
  groups.done.sort(samplesFirst((a, b) => b.position - a.position));
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
