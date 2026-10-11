import { describe, expect, it } from 'vitest';
import { nextId, progressOf } from '../src/lib/acceptance';

const item = (id: string, done: boolean) => ({ id, text: `text ${id}`, done });

describe('progressOf', () => {
  it('counts the done conditions and says whether all are done', () => {
    expect(progressOf([item('AC-1', true), item('AC-2', false), item('AC-3', true)])).toEqual({
      done: 2,
      total: 3,
      complete: false,
    });
    expect(progressOf([item('AC-1', true)])).toEqual({ done: 1, total: 1, complete: true });
  });

  it('has no progress and is not complete without conditions', () => {
    expect(progressOf([])).toEqual({ done: 0, total: 0, complete: false });
  });
});

describe('nextId', () => {
  it('is the number after the largest one ever shown, so a removed number is not reused', () => {
    expect(nextId([])).toBe('AC-1');
    expect(nextId(['AC-1', 'AC-2'])).toBe('AC-3');
    expect(nextId(['AC-1', 'AC-7', 'AC-3'])).toBe('AC-8');
  });

  it('ignores IDs that are not of the form AC-n', () => {
    expect(nextId(['AC-2', 'x', 'AC-x', 'ac-9'])).toBe('AC-3');
  });
});
