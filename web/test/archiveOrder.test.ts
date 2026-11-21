import { describe, expect, it } from 'vitest';
import { sortArchivedNewestFirst } from '../src/features/tasks/api/read';

const ids = (tasks: { id: number }[]) => tasks.map((task) => task.id);

describe('sortArchivedNewestFirst', () => {
  it('puts the newest archive time first', () => {
    const sorted = sortArchivedNewestFirst([
      { id: 1, archivedAt: '2026-10-01T10:00:00Z' },
      { id: 2, archivedAt: '2026-10-03T08:00:00Z' },
      { id: 3, archivedAt: '2026-10-02T23:59:59Z' },
    ]);
    expect(ids(sorted)).toEqual([2, 3, 1]);
  });

  it('breaks equal times by the higher id first', () => {
    const at = '2026-10-01T10:00:00Z';
    const sorted = sortArchivedNewestFirst([
      { id: 4, archivedAt: at },
      { id: 9, archivedAt: at },
      { id: 6, archivedAt: at },
    ]);
    expect(ids(sorted)).toEqual([9, 6, 4]);
  });

  it('puts cards without an archive time last, higher id first', () => {
    const sorted = sortArchivedNewestFirst([
      { id: 8 },
      { id: 1, archivedAt: '2026-10-01T10:00:00Z' },
      { id: 12, archivedAt: null },
      { id: 5, archivedAt: 'not a time' },
    ]);
    expect(ids(sorted)).toEqual([1, 12, 8, 5]);
  });

  it('does not change the input array', () => {
    const input = [
      { id: 1, archivedAt: '2026-10-01T10:00:00Z' },
      { id: 2, archivedAt: '2026-10-02T10:00:00Z' },
    ];
    sortArchivedNewestFirst(input);
    expect(ids(input)).toEqual([1, 2]);
  });
});
