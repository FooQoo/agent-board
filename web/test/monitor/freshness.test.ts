import { describe, expect, it } from 'vitest';
import { monitorFreshness } from '../../src/pages/monitor/model/freshness';

const base = {
  problems: [],
  projectId: 'a'.repeat(32),
  stream: 'connected' as const,
  lastFetchedAt: '2026-01-01T00:00:00Z',
};

describe('monitorFreshness', () => {
  it('loads while there is nothing to show, and errors when the first read failed', () => {
    expect(monitorFreshness({ ...base, state: 'absent', hasData: false }).state).toBe('loading');
    expect(monitorFreshness({ ...base, state: 'loading', hasData: false }).state).toBe('loading');
    expect(monitorFreshness({ ...base, state: 'error', hasData: false }).state).toBe('error');
  });

  it('is fresh only while the notifications arrive, and stale when they stop', () => {
    expect(monitorFreshness({ ...base, state: 'ready', hasData: true }).state).toBe('fresh');
    for (const stream of ['connecting', 'disconnected', 'hidden', 'stopped'] as const) {
      expect(
        monitorFreshness({ ...base, state: 'ready', hasData: true, stream }).state,
        stream,
      ).toBe('stale');
    }
  });

  it('syncs while a read runs, and keeps showing what it has when a read failed', () => {
    expect(monitorFreshness({ ...base, state: 'refreshing', hasData: true }).state).toBe('syncing');
    expect(monitorFreshness({ ...base, state: 'loading', hasData: true }).state).toBe('syncing');
    expect(monitorFreshness({ ...base, state: 'error', hasData: true }).state).toBe('stale');
    expect(monitorFreshness({ ...base, state: 'stale', hasData: true }).state).toBe('stale');
  });

  it('reports files that could not be read as partial, with their project', () => {
    const problems = [{ file: 'projects/x/tasks/1/task.json', field: 'body', reason: 'bad' }];
    const result = monitorFreshness({ ...base, state: 'ready', hasData: true, problems });
    expect(result.state).toBe('partial');
    expect(result.snapshotProblems).toEqual([{ projectId: base.projectId, ...problems[0] }]);
  });

  it('passes the time of the last read on', () => {
    expect(monitorFreshness({ ...base, state: 'ready', hasData: true }).lastFetchedAt).toBe(
      base.lastFetchedAt,
    );
  });
});
