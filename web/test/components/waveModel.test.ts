import { describe, expect, it } from 'vitest';
import {
  moveTask,
  moveWave,
  normalizeWaves,
  targetOfGroup,
  unlistedOf,
  waveStatuses,
} from '../../src/features/epics/editor/waveModel';
import { makeTask } from '../fixtures';

const members = [
  makeTask({ id: 1, taskStatus: 'done' }),
  makeTask({ id: 2, taskStatus: 'doing' }),
  makeTask({ id: 3 }),
  makeTask({ id: 4 }),
];

describe('normalizeWaves', () => {
  it('keeps members once, in order, and drops empty waves', () => {
    expect(normalizeWaves([[9], [2, 2, 1], [], [3, 8]], members)).toEqual([[2, 1], [3]]);
  });
});

describe('unlistedOf', () => {
  it('lists the members no wave lists by ascending ID', () => {
    expect(unlistedOf([[3], [1]], members)).toEqual([2, 4]);
  });
});

describe('moveTask', () => {
  const waves = [[1], [2, 3], [4]];

  it('reorders a task within its wave', () => {
    expect(moveTask(waves, 3, { kind: 'wave', wave: 1, index: 0 })).toEqual([[1], [3, 2], [4]]);
  });

  it('moves a task into another wave at a place, or at the end', () => {
    expect(moveTask(waves, 4, { kind: 'wave', wave: 1, index: 1 })).toEqual([[1], [2, 4, 3]]);
    expect(moveTask(waves, 1, { kind: 'wave', wave: 2, index: null })).toEqual([
      [2, 3],
      [4, 1],
    ]);
  });

  it('makes a new wave at the end', () => {
    expect(moveTask(waves, 2, { kind: 'new' })).toEqual([[1], [3], [4], [2]]);
  });

  it('drops a wave the move empties, keeping the target wave', () => {
    expect(moveTask(waves, 1, { kind: 'wave', wave: 1, index: 0 })).toEqual([[1, 2, 3], [4]]);
    expect(moveTask([[1], [2]], 1, { kind: 'new' })).toEqual([[2], [1]]);
  });

  it('takes a task out of every wave', () => {
    expect(moveTask(waves, 4, { kind: 'unlisted' })).toEqual([[1], [2, 3]]);
  });

  it('adds an unlisted task to a wave', () => {
    expect(moveTask([[1]], 3, { kind: 'wave', wave: 0, index: 0 })).toEqual([[3, 1]]);
  });

  it('does not change the input', () => {
    const input = [[1], [2]];
    moveTask(input, 1, { kind: 'new' });
    expect(input).toEqual([[1], [2]]);
  });
});

describe('moveWave', () => {
  it('moves a wave and keeps its tasks together', () => {
    expect(moveWave([[1], [2, 3], [4]], 2, 0)).toEqual([[4], [1], [2, 3]]);
    expect(moveWave([[1], [2, 3], [4]], 0, 1)).toEqual([[2, 3], [1], [4]]);
  });

  it('ignores a move to the same place or out of range', () => {
    const waves = [[1], [2]];
    expect(moveWave(waves, 1, 1)).toBe(waves);
    expect(moveWave(waves, 0, 5)).toBe(waves);
  });
});

describe('waveStatuses', () => {
  it('derives done, in progress and waiting from the task statuses', () => {
    expect(waveStatuses([[1], [2], [3, 4]], members)).toEqual([
      { kind: 'done' },
      { kind: 'active' },
      { kind: 'waiting', blockers: [2] },
    ]);
  });

  it('waits for every task of earlier waves that is not Done', () => {
    expect(waveStatuses([[2], [3], [4]], members)[2]).toEqual({
      kind: 'waiting',
      blockers: [2, 3],
    });
  });
});

describe('targetOfGroup', () => {
  it('reads the group ids of the editor', () => {
    expect(targetOfGroup('wave-2', 1)).toEqual({ kind: 'wave', wave: 2, index: 1 });
    expect(targetOfGroup('new-wave', null)).toEqual({ kind: 'new' });
    expect(targetOfGroup('unlisted', null)).toEqual({ kind: 'unlisted' });
    expect(targetOfGroup('todo', null)).toBeNull();
  });
});
