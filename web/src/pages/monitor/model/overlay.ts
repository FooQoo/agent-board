import type { MonitorTask } from '../contracts';
import type { MonitorSection } from '../components/MonitorSectionHeader';
import { sortDone, sortLane } from './sort';

export type Lanes = Record<MonitorSection, MonitorTask[]>;

/**
 * What the phone has saved but the last read of the project does not show yet. The lanes are drawn
 * with it on top, so a moved or archived card does not come back while the read is on its way.
 */
export interface LaneOverlay {
  /** Cards moved to another lane. */
  moved: ReadonlyMap<number, MonitorSection>;
  /** Cards archived. */
  hidden: ReadonlySet<number>;
}

export const EMPTY_OVERLAY: LaneOverlay = { moved: new Map(), hidden: new Set() };

/** The lanes as the person expects to see them: the read, with the saved changes on top. */
export function applyOverlay(lanes: Lanes, overlay: LaneOverlay, now: string): Lanes {
  const { moved, hidden } = overlay;
  if (moved.size === 0 && hidden.size === 0) return lanes;
  const all = [...lanes.backlog, ...lanes.todo, ...lanes.doing, ...lanes.done];
  const next: Lanes = { backlog: [], todo: [], doing: [], done: [] };
  for (const name of ['backlog', 'todo', 'doing', 'done'] as const) {
    next[name] = lanes[name].filter(
      (item) => !hidden.has(item.task.id) && !moved.has(item.task.id),
    );
  }
  for (const [id, target] of moved) {
    const item = all.find((entry) => entry.task.id === id);
    if (!item || hidden.has(id)) continue;
    if (item.task.taskStatus === target) {
      next[target].push(item);
      continue;
    }
    // A move puts the card at the end of its new lane, and it is no longer running.
    const end = Math.max(0, ...next[target].map((entry) => entry.task.position)) + 1;
    next[target].push({
      ...item,
      task: {
        ...item.task,
        taskStatus: target,
        taskStatusChangedAt: now,
        agentStatus: 'idle',
        position: end,
      },
    });
  }
  next.backlog = sortLane(next.backlog);
  next.todo = sortLane(next.todo);
  next.doing = sortLane(next.doing);
  next.done = sortDone(next.done);
  return next;
}

/**
 * Drops what a new read already shows: a move once the card reads in its new lane; an
 * archive once the card is gone. A read that is still older than the save keeps the change on top.
 */
export function settleOverlay(lanes: Lanes, overlay: LaneOverlay): LaneOverlay {
  const where = new Map<number, MonitorSection>();
  for (const name of ['todo', 'doing', 'done'] as const)
    for (const item of lanes[name]) where.set(item.task.id, name);
  const moved = new Map(
    [...overlay.moved].filter(([id, target]) => where.has(id) && where.get(id) !== target),
  );
  const hidden = new Set([...overlay.hidden].filter((id) => where.has(id)));
  if (moved.size === overlay.moved.size && hidden.size === overlay.hidden.size) return overlay;
  return { moved, hidden };
}
