import { describe, expect, it } from 'vitest';
import { matchesPickerQuery, orderPickerTasks, type PickerTask } from './pickerTasks';

const task = (id: number, taskStatus: PickerTask['taskStatus'], at = ''): PickerTask => ({
  id,
  title: 'Login',
  taskStatus,
  taskStatusChangedAt: at,
});

describe('orderPickerTasks', () => {
  it('lists doing, then todo, then done, newest move first', () => {
    const ordered = orderPickerTasks([
      task(1, 'done', '2026-01-01'),
      task(2, 'todo', '2026-01-01'),
      task(3, 'doing', '2026-01-01'),
      task(4, 'doing', '2026-02-01'),
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual([4, 3, 2, 1]);
  });
});

describe('orderPickerTasks with the Backlog', () => {
  it('lists the Backlog after Todo and before Done', () => {
    const ordered = orderPickerTasks([
      task(1, 'done', '2026-03-01'),
      task(2, 'backlog', '2026-03-01'),
      task(3, 'todo', '2026-01-01'),
      task(4, 'doing', '2026-01-01'),
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual([4, 3, 2, 1]);
  });
});

describe('matchesPickerQuery', () => {
  it('matches everything for an empty query', () => {
    expect(matchesPickerQuery(task(1, 'todo'), '  ')).toBe(true);
  });

  it('matches the start of the number, with or without #', () => {
    expect(matchesPickerQuery(task(552, 'todo'), '55')).toBe(true);
    expect(matchesPickerQuery(task(552, 'todo'), '#552')).toBe(true);
    expect(matchesPickerQuery(task(552, 'todo'), '52')).toBe(false);
  });

  it('matches the title without regard to case', () => {
    expect(matchesPickerQuery(task(9, 'todo'), 'login')).toBe(true);
    expect(matchesPickerQuery(task(9, 'todo'), 'logout')).toBe(false);
  });
});
