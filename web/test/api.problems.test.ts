import { describe, expect, it } from 'vitest';
import { problemOf, WriteError } from '../src/app/api';

describe('problemOf', () => {
  it('reads the file, field and reason of a file_invalid answer', () => {
    const error = new WriteError('ID: wrong', 422, 'file_invalid', 'tasks/3/TASK.md is not valid.');
    expect(problemOf(error)).toEqual({ file: 'tasks/3/TASK.md', field: 'ID', reason: 'wrong' });
  });

  it('is null for other errors', () => {
    expect(problemOf(new WriteError('x', 409, 'request_changed'))).toBeNull();
    expect(problemOf(new Error('network'))).toBeNull();
  });
});
