// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { makeTask, PROJECT_A } from '../fixtures';
import type { MonitorTask } from '../../src/pages/monitor/contracts';
import {
  EMPTY_OVERLAY,
  type Lanes,
  applyOverlay,
  settleOverlay,
} from '../../src/pages/monitor/model/overlay';

const item = (id: number, lane: 'todo' | 'doing' | 'done', position: number): MonitorTask => ({
  projectId: PROJECT_A.id,
  projectName: PROJECT_A.name,
  task: { ...makeTask({ id }), taskStatus: lane, position },
});
const lanes = (todo: number[], doing: number[] = [], done: number[] = []): Lanes => ({
  todo: todo.map((id, index) => item(id, 'todo', index + 1)),
  doing: doing.map((id, index) => item(id, 'doing', index + 1)),
  done: done.map((id, index) => item(id, 'done', index + 1)),
});
const ids = (shown: Lanes) => ({
  todo: shown.todo.map((entry) => entry.task.id),
  doing: shown.doing.map((entry) => entry.task.id),
  done: shown.done.map((entry) => entry.task.id),
});
const NOW = '2099-01-01T00:00:00Z';

describe('lane overlay', () => {
  it('keeps a saved order through a read that still has the old one', () => {
    const overlay = { ...EMPTY_OVERLAY, order: { lane: 'todo' as const, ids: [3, 1, 2] } };
    const stale = lanes([1, 2, 3]);
    expect(ids(applyOverlay(stale, overlay, NOW)).todo).toEqual([3, 1, 2]);
    expect(settleOverlay(stale, overlay)).toBe(overlay);
    expect(settleOverlay(lanes([3, 1, 2]), overlay).order).toBeNull();
    // Someone else changed the lane: the read wins.
    expect(settleOverlay(lanes([1, 2]), overlay).order).toBeNull();
  });

  it('shows a moved card at the end of its new lane until a read has it there', () => {
    const overlay = { ...EMPTY_OVERLAY, moved: new Map([[1, 'doing' as const]]) };
    const shown = applyOverlay(lanes([1, 2], [5]), overlay, NOW);
    expect(ids(shown)).toEqual({ todo: [2], doing: [5, 1], done: [] });
    expect(settleOverlay(lanes([1, 2], [5]), overlay)).toBe(overlay);
    expect(settleOverlay(lanes([2], [5, 1]), overlay).moved.size).toBe(0);
  });

  it('hides archived cards until a read drops them', () => {
    const overlay = { ...EMPTY_OVERLAY, hidden: new Set([7, 8]) };
    expect(ids(applyOverlay(lanes([], [], [7, 8, 9]), overlay, NOW)).done).toEqual([9]);
    expect(settleOverlay(lanes([], [], [8, 9]), overlay).hidden).toEqual(new Set([8]));
  });
});
