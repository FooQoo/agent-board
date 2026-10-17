import type { MonitorTask } from '../contracts';

function time(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/** A lane timestamp stays stable when a later work note or body edit is saved. */
export function completedAt(item: MonitorTask): string | null {
  return item.task.taskStatus === 'done' ? item.task.taskStatusChangedAt : null;
}

function stableTie(a: MonitorTask, b: MonitorTask): number {
  return a.projectId.localeCompare(b.projectId) || a.task.id - b.task.id;
}

function byTime(getTime: (item: MonitorTask) => string | null, newestFirst: boolean) {
  return (a: MonitorTask, b: MonitorTask) => {
    const aTime = time(getTime(a));
    const bTime = time(getTime(b));
    if (aTime === bTime) return stableTie(a, b);
    if (aTime === Number.NEGATIVE_INFINITY) return 1;
    if (bTime === Number.NEGATIVE_INFINITY) return -1;
    return newestFirst ? bTime - aTime : aTime - bTime;
  };
}

/** Keep project groups stable and preserve each board lane's manual card order. */
export function sortLane(items: readonly MonitorTask[]): MonitorTask[] {
  return [...items].sort(
    (a, b) =>
      a.projectName.localeCompare(b.projectName) ||
      a.projectId.localeCompare(b.projectId) ||
      a.task.position - b.task.position ||
      a.task.id - b.task.id,
  );
}

export function sortDone(items: readonly MonitorTask[]): MonitorTask[] {
  return [...items].sort(byTime(completedAt, true));
}
