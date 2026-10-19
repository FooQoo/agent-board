import { describe, expect, it } from 'vitest';
import { findTask, groupTasks, nextSelection } from '../src/features/tasks/model/board';
import { fixtureBoard, makeTask } from './fixtures';

const ids = (tasks: { id: number }[]) => tasks.map((c) => c.id);

describe('groupCards', () => {
  it('splits tasks by column', () => {
    const groups = groupTasks(fixtureBoard.tasks);
    expect(ids(groups.todo)).toEqual([14, 15, 16]);
    expect(ids(groups.doing)).toEqual([11, 12, 13]);
    expect(ids(groups.done)).toEqual([9, 8]);
  });

  it('orders todo and doing by ascending position', () => {
    const groups = groupTasks([
      makeTask({ id: 1, taskStatus: 'todo', position: 3 }),
      makeTask({ id: 2, taskStatus: 'todo', position: 1 }),
      makeTask({ id: 3, taskStatus: 'doing', position: 2 }),
      makeTask({ id: 4, taskStatus: 'doing', position: 1 }),
    ]);
    expect(ids(groups.todo)).toEqual([2, 1]);
    expect(ids(groups.doing)).toEqual([4, 3]);
  });

  it('orders done by descending position', () => {
    const groups = groupTasks([
      makeTask({ id: 1, taskStatus: 'done', position: 1 }),
      makeTask({ id: 2, taskStatus: 'done', position: 3 }),
      makeTask({ id: 3, taskStatus: 'done', position: 2 }),
    ]);
    expect(ids(groups.done)).toEqual([2, 3, 1]);
  });

  it('returns empty lists for an empty board', () => {
    expect(groupTasks([])).toEqual({ todo: [], doing: [], done: [] });
  });

  it('does not mutate its input', () => {
    const input = [makeTask({ id: 1, position: 2 }), makeTask({ id: 2, position: 1 })];
    groupTasks(input);
    expect(ids(input)).toEqual([1, 2]);
  });
});

describe('findCard', () => {
  it('finds a task by id', () => {
    expect(findTask(fixtureBoard.tasks, 12)?.title).toBe('Restore a board from JSON');
  });

  it('returns null for a missing id or no id', () => {
    expect(findTask(fixtureBoard.tasks, 99)).toBeNull();
    expect(findTask(fixtureBoard.tasks, null)).toBeNull();
  });
});

describe('nextSelection', () => {
  it('keeps a selection that still exists', () => {
    expect(nextSelection(fixtureBoard.tasks, 8)).toBe(8);
  });

  it('returns null when the selected task is gone', () => {
    expect(nextSelection(fixtureBoard.tasks, 99)).toBeNull();
  });

  it('returns null when nothing is selected', () => {
    expect(nextSelection(fixtureBoard.tasks, null)).toBeNull();
  });
});
