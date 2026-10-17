import { beforeEach, describe, expect, it } from 'vitest';
import { createMonitorFixtureProps } from '../../src/monitor/mock';

describe('AC-1 monitor fixture', () => {
  beforeEach(() => window.history.replaceState(null, '', '/?fixture=ac1'));

  it('provides the planned 1 Todo, 2 Doing and 8 Done tasks', () => {
    const fixture = createMonitorFixtureProps();
    expect(fixture.summary).toEqual({ todo: 1, doing: 2, done: 8 });
    expect(fixture.todo.map(({ task }) => task.id)).toEqual([1]);
    expect(fixture.doing.map(({ task }) => task.id)).toEqual([2, 3]);
    expect(fixture.done.map(({ task }) => task.id)).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
  });
});
