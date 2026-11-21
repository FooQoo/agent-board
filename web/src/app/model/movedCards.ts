import type { TaskSummary } from '../../shared/api/contracts';

type Status = TaskSummary['taskStatus'];

/**
 * A card a person moved: where it was put, and, once the server has accepted the move, the read
 * the screen had at that moment. That read is the last one that may predate the save.
 */
export interface MovedEntry {
  to: Status;
  settledAt: readonly TaskSummary[] | null;
}

export type MovedCards = ReadonlyMap<number, MovedEntry>;

/** The read with the moved cards in their new lanes. */
export function showMoved(read: TaskSummary[], moved: MovedCards): TaskSummary[] {
  if (moved.size === 0) return read;
  return read.map((task) => {
    const entry = moved.get(task.id);
    return entry === undefined ? task : { ...task, taskStatus: entry.to };
  });
}

/**
 * Drops what a read no longer needs. While the save is in flight an entry stays against any read,
 * so a snapshot that predates the save does not move the card back. Once the save is accepted, the
 * first read that is not the one seen then is newer than the save and wins, whatever lane it shows
 * (an agent may have moved the card on). A read that shows the card in the target lane, or a card
 * that is gone, ends the entry at any time.
 */
export function settleMoved(moved: MovedCards, read: TaskSummary[]): MovedCards {
  const waiting = [...moved].filter(([id, entry]) => {
    const task = read.find((item) => item.id === id);
    if (task === undefined || task.taskStatus === entry.to) return false;
    return entry.settledAt === null || entry.settledAt === read;
  });
  return waiting.length === moved.size ? moved : new Map(waiting);
}

/** Marks the save of a card as accepted, remembering the read the screen had then. */
export function markSettled(moved: MovedCards, id: number, read: TaskSummary[]): MovedCards {
  const entry = moved.get(id);
  if (entry === undefined || entry.settledAt !== null) return moved;
  return new Map(moved).set(id, { ...entry, settledAt: read });
}
