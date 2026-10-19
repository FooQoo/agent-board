import { describe, expect, it } from 'vitest';
import {
  acceptanceProblem,
  composeNewText,
  nextId,
  progressOf,
} from '../src/features/tasks/acceptance/model/acceptance';

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

describe('composeNewText', () => {
  it('writes the frontmatter of a new file from the body and the conditions', () => {
    const text = composeNewText('Body.\n', [{ id: 'AC-1', text: 'Works: "yes"', done: false }]);
    expect(text).toBe(
      '---\nacceptance:\n  - id: "AC-1"\n    text: "Works: \\"yes\\""\n    done: false\n---\n\nBody.\n',
    );
  });

  it('writes an empty list when there are no conditions', () => {
    expect(composeNewText('', [])).toBe('---\nacceptance: []\n---\n\n');
  });
});

describe('acceptanceProblem', () => {
  it('names the first condition whose text is blank or too long', () => {
    expect(acceptanceProblem([{ id: 'AC-1', text: 'ok', done: false }])).toBeNull();
    expect(acceptanceProblem([{ id: 'AC-1', text: ' ', done: false }])).not.toBeNull();
    expect(acceptanceProblem([{ id: 'AC-1', text: 'x'.repeat(2001), done: false }])).not.toBeNull();
  });
});
