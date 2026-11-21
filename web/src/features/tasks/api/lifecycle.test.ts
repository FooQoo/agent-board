import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { WriteError } from '../../../shared/api/writeErrors';
import { moveFailureNotice, TaskStatusChangedError } from './lifecycle';

const t = ((key: string, options?: object) =>
  `${key}${options ? JSON.stringify(options) : ''}`) as unknown as TFunction;

describe('moveFailureNotice', () => {
  it('shows the reason the server gave for a refused move', () => {
    const reason = 'Only a Todo card that has not been started can go back to the Backlog.';
    const cause = new WriteError(reason, 400, 'invalid_value');
    expect(moveFailureNotice(cause, t)).toBe(`moveNotice.refused${JSON.stringify({ reason })}`);
  });

  it('names where a task that moved meanwhile is now', () => {
    const cause = new TaskStatusChangedError('changed', 'done');
    expect(moveFailureNotice(cause, t)).toContain('moveNotice.statusChanged');
  });

  it('falls back to the generic notice for anything else', () => {
    expect(moveFailureNotice(new Error('network'), t)).toBe('moveNotice.failed');
  });
});
