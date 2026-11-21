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
  /**
   * Moved cards whose save the server has accepted, each with the read the screen had at that
   * moment: the last read that may predate the save. A different read is newer and wins.
   */
  settled: ReadonlyMap<number, Lanes>;
  /** Cards archived. */
  hidden: ReadonlySet<number>;
}

export const EMPTY_OVERLAY: LaneOverlay = {
  moved: new Map(),
  settled: new Map(),
  hidden: new Set(),
};

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
 * Drops what a new read already shows. A move stays against any read while its save is in flight,
 * so a snapshot that predates the save does not bring the card back. Once the save is accepted, the
 * first read that is not the one seen then is newer and wins, whatever lane it shows (an agent may
 * have moved the card on); a read that shows the card in the target lane ends the move at any time.
 * An archive goes once the card is gone from the read.
 */
export function settleOverlay(lanes: Lanes, overlay: LaneOverlay): LaneOverlay {
  const where = new Map<number, MonitorSection>();
  for (const name of ['todo', 'doing', 'done'] as const)
    for (const item of lanes[name]) where.set(item.task.id, name);
  const moved = new Map(
    [...overlay.moved].filter(([id, target]) => {
      if (!where.has(id) || where.get(id) === target) return false;
      const seen = overlay.settled.get(id);
      return seen === undefined || seen === lanes;
    }),
  );
  const hidden = new Set([...overlay.hidden].filter((id) => where.has(id)));
  if (moved.size === overlay.moved.size && hidden.size === overlay.hidden.size) return overlay;
  const settled = new Map([...overlay.settled].filter(([id]) => moved.has(id)));
  return { moved, settled, hidden };
}
