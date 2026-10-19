import type { Board, Epic, EpicRef, Problem, Task } from './contracts';

/** A card as the server writes it: the epic is an ID that the board resolves against `epics`. */
export type WireTask = Omit<Task, 'epic'> & { epicId: string | null };

/** The board as the server writes it. The snapshot joins each card with its epic. */
export interface WireBoard {
  project: Board['project'];
  version: string;
  cursor: string;
  epics: Epic[];
  epicTaskCounts: Board['epicTaskCounts'];
  tasks: WireTask[];
  problems: Problem[];
}

export function toTask(wire: WireTask, epics: readonly Epic[]): Task {
  const { epicId, ...rest } = wire;
  const found = epicId === null ? undefined : epics.find((e) => e.id === epicId);
  const epic: EpicRef | null = found
    ? { id: found.id, name: found.name, color: found.color }
    : null;
  return { ...rest, epic };
}

/** Turns a server board into the snapshot the screens use. An epic missing from `epics` leaves the card unlabeled. */
export function toBoard(wire: WireBoard): Board {
  return {
    project: wire.project,
    version: wire.version,
    cursor: wire.cursor,
    epics: wire.epics,
    epicTaskCounts: wire.epicTaskCounts,
    tasks: wire.tasks.map((task) => toTask(task, wire.epics)),
    problems: wire.problems,
  };
}
