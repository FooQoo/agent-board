import type { MonitorCard } from '../contracts';

function time(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/** A lane timestamp stays stable when a later work note or body edit is saved. */
export function completedAt(item: MonitorCard): string | null {
  return item.card.cardStatus === 'done' ? item.card.cardStatusChangedAt : null;
}

function stableTie(a: MonitorCard, b: MonitorCard): number {
  return a.projectId.localeCompare(b.projectId) || a.card.id - b.card.id;
}

function byTime(getTime: (item: MonitorCard) => string | null, newestFirst: boolean) {
  return (a: MonitorCard, b: MonitorCard) => {
    const aTime = time(getTime(a));
    const bTime = time(getTime(b));
    if (aTime === bTime) return stableTie(a, b);
    if (aTime === Number.NEGATIVE_INFINITY) return 1;
    if (bTime === Number.NEGATIVE_INFINITY) return -1;
    return newestFirst ? bTime - aTime : aTime - bTime;
  };
}

/** Keep project groups stable and preserve each board lane's manual card order. */
export function sortLane(items: readonly MonitorCard[]): MonitorCard[] {
  return [...items].sort(
    (a, b) =>
      a.projectName.localeCompare(b.projectName) ||
      a.projectId.localeCompare(b.projectId) ||
      a.card.position - b.card.position ||
      a.card.id - b.card.id,
  );
}

export function sortDone(items: readonly MonitorCard[]): MonitorCard[] {
  return [...items].sort(byTime(completedAt, true));
}
