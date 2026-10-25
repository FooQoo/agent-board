import type { Epic, EpicRef, Task } from './contracts';

/** A card as the server writes it: the epic is an ID that the board resolves against `epics`. */
export type WireTask = Omit<Task, 'epic'> & { epicId: string | null };

/** Joins a card with its epic. An epic missing from `epics` leaves the card unlabeled. */
export function toTask(wire: WireTask, epics: readonly Epic[]): Task {
  const { epicId, ...rest } = wire;
  const found = epicId === null ? undefined : epics.find((e) => e.id === epicId);
  const epic: EpicRef | null = found
    ? { id: found.id, name: found.name, color: found.color }
    : null;
  return { ...rest, epic };
}
