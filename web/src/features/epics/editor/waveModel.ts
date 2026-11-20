import type { TaskSummary } from '../../../shared/api/contracts';

/** The waves of an epic: task IDs in work order. A wave's tasks can run in parallel. */
export type Waves = number[][];

/** Where a task goes: a place in a wave, a wave of its own at the end, or out of every wave. */
export type WaveTarget =
  | { kind: 'wave'; wave: number; index: number | null }
  | { kind: 'new' }
  | { kind: 'unlisted' };

/** The ids of the drop areas: a wave, the area that makes a new wave, and the tasks no wave lists. */
export const NEW_WAVE_GROUP = 'new-wave';
export const UNLISTED_GROUP = 'unlisted';
export const waveGroup = (index: number): string => `wave-${index}`;

/** The target a drop group names, or null for a group this editor does not own. */
export function targetOfGroup(group: string, index: number | null): WaveTarget | null {
  if (group === NEW_WAVE_GROUP) return { kind: 'new' };
  if (group === UNLISTED_GROUP) return { kind: 'unlisted' };
  const match = /^wave-(\d+)$/.exec(group);
  return match ? { kind: 'wave', wave: Number(match[1]), index } : null;
}

/**
 * The waves as the editor shows them: only tasks that are members of the epic, each once, and no
 * empty wave. A wave never saves empty, so the editor never keeps one.
 */
export function normalizeWaves(
  waves: readonly (readonly number[])[],
  members: readonly TaskSummary[],
): Waves {
  const ids = new Set(members.map((task) => task.id));
  const seen = new Set<number>();
  const result: Waves = [];
  for (const wave of waves) {
    const kept = wave.filter((id) => {
      if (!ids.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    if (kept.length > 0) result.push(kept);
  }
  return result;
}

/** The members no wave lists, in ascending ID order: they are never held back. */
export function unlistedOf(
  waves: readonly (readonly number[])[],
  members: readonly TaskSummary[],
): number[] {
  const listed = new Set(waves.flat());
  return members
    .map((task) => task.id)
    .filter((id) => !listed.has(id))
    .sort((a, b) => a - b);
}

/**
 * Moves a task to `target`. A place in a wave counts from the wave's tasks without the moved one
 * (`null` is the end). A wave that the move empties is dropped. The input is not changed.
 */
export function moveTask(waves: Waves, taskId: number, target: WaveTarget): Waves {
  const without = waves.map((wave) => wave.filter((id) => id !== taskId));
  let next: (number[] | null)[] = without;
  if (target.kind === 'new') next = [...without, [taskId]];
  else if (target.kind === 'wave') {
    const wave = without[target.wave];
    if (!wave) return waves;
    const at =
      target.index === null ? wave.length : Math.max(0, Math.min(target.index, wave.length));
    next = without.map((ids, i) =>
      i === target.wave ? [...ids.slice(0, at), taskId, ...ids.slice(at)] : ids,
    );
  }
  return next.filter((wave): wave is number[] => wave !== null && wave.length > 0);
}

/** Moves the wave at `from` to `to`. The input is not changed. */
export function moveWave(waves: Waves, from: number, to: number): Waves {
  if (from === to || !waves[from] || to < 0 || to >= waves.length) return waves;
  const next = [...waves];
  const [moved] = next.splice(from, 1);
  if (moved) next.splice(to, 0, moved);
  return next;
}

/** What a wave shows: done, waiting for the tasks of earlier waves that are not Done, or in progress. */
export type WaveStatus =
  | { kind: 'done' }
  | { kind: 'active' }
  | { kind: 'waiting'; blockers: number[] };

/** The status of every wave, from the task statuses. */
export function waveStatuses(
  waves: readonly (readonly number[])[],
  tasks: readonly TaskSummary[],
): WaveStatus[] {
  const done = new Map(tasks.map((task) => [task.id, task.taskStatus === 'done']));
  const open: number[] = [];
  return waves.map((wave) => {
    const status: WaveStatus = wave.every((id) => done.get(id) === true)
      ? { kind: 'done' }
      : open.length > 0
        ? { kind: 'waiting', blockers: [...open] }
        : { kind: 'active' };
    open.push(...wave.filter((id) => done.get(id) !== true));
    return status;
  });
}
