import { describe, expect, it } from 'vitest';
import { makeTask, PROJECT_A, PROJECT_B } from '../fixtures';
import type { MonitorTask } from '../../src/pages/monitor/contracts';
import { completedAt, sortDone, sortLane } from '../../src/pages/monitor/model/sort';

const item = (
  projectId: string,
  id: number,
  changed: string,
  history: MonitorTask['task']['history'] = [],
): MonitorTask => ({
  projectId,
  projectName: projectId === PROJECT_A.id ? PROJECT_A.name : PROJECT_B.name,
  task: makeTask({ id, agentStatusChangedAt: changed, updatedAt: '2099-01-01T00:00:00Z', history }),
});
describe('monitor ordering', () => {
  it('preserves manual lane order within stable project groups, independently of run-state times', () => {
    const beta = item(PROJECT_B.id, 1, '2099-01-01T00:00:00Z');
    const first = item(PROJECT_A.id, 9, '2026-10-03T00:00:00Z');
    const second = item(PROJECT_A.id, 2, '2026-10-01T00:00:00Z');
    first.task.position = 1;
    second.task.position = 2;
    expect(sortLane([beta, second, first]).map(({ task }) => task.id)).toEqual([9, 2, 1]);
    second.task.position = 1;
    expect(sortLane([beta, first, second]).map(({ task }) => task.id)).toEqual([2, 9, 1]);
  });

  it('uses the lane timestamp for Done ordering despite later notes, edits and archive operations', () => {
    const older = item(PROJECT_A.id, 1, '2099-01-01T00:00:00Z');
    const reopened = item(PROJECT_A.id, 2, '2099-01-01T00:00:00Z', [
      { at: '2099-01-01T00:00:00Z', reason: 'Added a later work note.' },
    ]);
    const unknown = item(PROJECT_A.id, 3, '2099-01-01T00:00:00Z');
    older.task.taskStatus = reopened.task.taskStatus = unknown.task.taskStatus = 'done';
    older.task.taskStatusChangedAt = '2026-10-01T00:00:00Z';
    reopened.task.taskStatusChangedAt = '2026-10-05T00:00:00Z';
    unknown.task.taskStatusChangedAt = 'invalid';
    expect(completedAt(reopened)).toBe('2026-10-05T00:00:00Z');
    expect(sortDone([unknown, older, reopened]).map(({ task }) => task.id)).toEqual([2, 1, 3]);
    reopened.task.taskStatus = 'todo';
    expect(completedAt(reopened)).toBeNull();
  });
});
