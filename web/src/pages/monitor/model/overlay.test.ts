import { describe, expect, it } from 'vitest';
import { makeMonitorTask, makeProject, makeTask } from '../../../../.storybook/support/fixtures';
import {
  EMPTY_OVERLAY,
  type LaneOverlay,
  type Lanes,
  applyOverlay,
  settleOverlay,
} from './overlay';

const project = makeProject({});
const lanes = (name: keyof Lanes): Lanes => ({
  backlog: [],
  todo: [],
  doing: [],
  done: [],
  [name]: [makeMonitorTask(makeTask({ id: 1, taskStatus: name }), project)],
});
const moving = (settled?: Lanes): LaneOverlay => ({
  ...EMPTY_OVERLAY,
  moved: new Map([[1, 'doing' as const]]),
  settled: settled ? new Map([[1, settled]]) : new Map(),
});

describe('lane overlay of a move', () => {
  it('keeps the card in the target lane against a read older than the save', () => {
    const old = lanes('todo');
    expect(applyOverlay(old, moving(old), 'now').doing).toHaveLength(1);
    expect(settleOverlay(old, moving())).toEqual(moving());
    // The read seen when the save resolved is still the old one.
    const settled = moving(old);
    expect(settleOverlay(old, settled)).toBe(settled);
  });

  it('shows the lane of a newer read once the save was accepted, even another lane', () => {
    const settled = moving(lanes('todo'));
    const next = settleOverlay(lanes('done'), settled);
    expect(next.moved.size).toBe(0);
    expect(next.settled.size).toBe(0);
    expect(applyOverlay(lanes('done'), next, 'now').done).toHaveLength(1);
  });

  it('keeps an unsettled move against any read, and drops it when the target is read', () => {
    expect(settleOverlay(lanes('done'), moving()).moved.size).toBe(1);
    expect(settleOverlay(lanes('doing'), moving()).moved.size).toBe(0);
  });
});
