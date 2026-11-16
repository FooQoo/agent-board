import type { MonitorTask } from '../contracts';
import type { MonitorSection } from '../components/MonitorSectionHeader';
import { sortDone, sortLane } from './sort';

export type Lanes = Record<MonitorSection, MonitorTask[]>;

/**
 * What the phone has saved but the last read of the project does not show yet. The lanes are drawn
 * with it on top, so a card stays where the person put it while the read is on its way, the way the
 * PC board keeps a dropped card in place until the new order arrives.
 */
export interface LaneOverlay {
  /** A lane's new order, after a card was carried up or down. */
  order: { lane: MonitorSection; ids: number[] } | null;
  /** Cards moved to another lane. */
  moved: ReadonlyMap<number, MonitorSection>;
  /** Cards archived. */
  hidden: ReadonlySet<number>;
}

export const EMPTY_OVERLAY: LaneOverlay = { order: null, moved: new Map(), hidden: new Set() };

const idsOf = (items: readonly MonitorTask[]) => items.map((item) => item.task.id);

const sameSet = (a: readonly number[], b: readonly number[]) => {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
};

const sameOrder = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

/** The lanes as the person expects to see them: the read, with the saved changes on top. */
export function applyOverlay(lanes: Lanes, overlay: LaneOverlay, now: string): Lanes {
  const { order, moved, hidden } = overlay;
  if (order === null && moved.size === 0 && hidden.size === 0) return lanes;
  const all = [...lanes.todo, ...lanes.doing, ...lanes.done];
  const next: Lanes = { todo: [], doing: [], done: [] };
  for (const name of ['todo', 'doing', 'done'] as const) {
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
  next.todo = sortLane(next.todo);
  next.doing = sortLane(next.doing);
  next.done = sortDone(next.done);
  if (order !== null) {
    const items = next[order.lane];
    if (sameSet(idsOf(items), order.ids)) {
      const byId = new Map(items.map((item) => [item.task.id, item]));
      next[order.lane] = order.ids.flatMap((id) => byId.get(id) ?? []);
    }
  }
  return next;
}

/**
 * Drops what a new read already shows. A saved order goes once the lane reads in that order, or
 * once its cards change (someone else moved one); a move once the card reads in its new lane; an
 * archive once the card is gone. A read that is still older than the save keeps the change on top.
 */
export function settleOverlay(lanes: Lanes, overlay: LaneOverlay): LaneOverlay {
  let { order } = overlay;
  if (order !== null) {
    const ids = idsOf(lanes[order.lane]);
    if (sameOrder(ids, order.ids) || !sameSet(ids, order.ids)) order = null;
  }
  const where = new Map<number, MonitorSection>();
  for (const name of ['todo', 'doing', 'done'] as const)
    for (const item of lanes[name]) where.set(item.task.id, name);
  const moved = new Map(
    [...overlay.moved].filter(([id, target]) => where.has(id) && where.get(id) !== target),
  );
  const hidden = new Set([...overlay.hidden].filter((id) => where.has(id)));
  if (
    order === overlay.order &&
    moved.size === overlay.moved.size &&
    hidden.size === overlay.hidden.size
  )
    return overlay;
  return { order, moved, hidden };
}
