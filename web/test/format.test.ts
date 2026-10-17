import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import {
  taskCountLabel,
  columnLabel,
  formatShort,
  formatTime,
  stateLabel,
} from '../src/lib/format';
import { makeTask } from './fixtures';

const translate = ((key: string, options?: Record<string, unknown>): string => {
  const labels: Record<string, string> = {
    'status.cardCount': `${String(options?.count)}件`,
    'column.todo': '未着手',
    'column.doing': '進行中',
    'column.done': '完了',
    'runState.idle': '未稼働',
    'runState.running': '稼働中',
    'runState.pending': '待機中',
  };
  return labels[key] ?? key;
}) as unknown as TFunction;

describe('formatShort', () => {
  it('formats an RFC 3339 timestamp as local MM/DD HH:mm', () => {
    expect(formatShort('2026-10-02T01:08:00Z')).toBe('10/02 01:08');
  });

  it('zero-pads month, day, hour and minute', () => {
    expect(formatShort('2026-01-05T03:04:00Z')).toBe('01/05 03:04');
  });
});

describe('formatTime', () => {
  it('formats a date as local HH:mm', () => {
    expect(formatTime(new Date('2026-10-02T10:42:00Z'))).toBe('10:42');
    expect(formatTime(new Date('2026-10-02T09:05:00Z'))).toBe('09:05');
  });
});

describe('cardCountLabel', () => {
  it('uses the singular for exactly one task', () => {
    expect(taskCountLabel(1)).toBe('1 task');
  });

  it('uses the plural otherwise', () => {
    expect(taskCountLabel(0)).toBe('0 tasks');
    expect(taskCountLabel(8)).toBe('8 tasks');
  });

  it('uses the selected language for zero, one and multiple tasks', () => {
    expect(taskCountLabel(0, translate)).toBe('0件');
    expect(taskCountLabel(1, translate)).toBe('1件');
    expect(taskCountLabel(8, translate)).toBe('8件');
  });
});

describe('columnLabel', () => {
  it('capitalizes the column names', () => {
    expect(columnLabel('todo')).toBe('Todo');
    expect(columnLabel('doing')).toBe('Doing');
    expect(columnLabel('done')).toBe('Done');
  });

  it('translates each domain column value for display', () => {
    expect(columnLabel('todo', translate)).toBe('未着手');
    expect(columnLabel('doing', translate)).toBe('進行中');
    expect(columnLabel('done', translate)).toBe('完了');
  });
});

describe('stateLabel', () => {
  it('returns the run state label for doing tasks', () => {
    expect(stateLabel(makeTask({ id: 1, taskStatus: 'doing', agentStatus: 'idle' }))).toBe('Idle');
    expect(stateLabel(makeTask({ id: 1, taskStatus: 'doing', agentStatus: 'running' }))).toBe(
      'Running',
    );
    expect(stateLabel(makeTask({ id: 1, taskStatus: 'doing', agentStatus: 'pending' }))).toBe(
      'Pending',
    );
  });

  it('translates run state values only for doing tasks', () => {
    expect(
      stateLabel(makeTask({ id: 1, taskStatus: 'doing', agentStatus: 'idle' }), translate),
    ).toBe('未稼働');
    expect(
      stateLabel(makeTask({ id: 1, taskStatus: 'doing', agentStatus: 'running' }), translate),
    ).toBe('稼働中');
    expect(
      stateLabel(makeTask({ id: 1, taskStatus: 'doing', agentStatus: 'pending' }), translate),
    ).toBe('待機中');
    expect(stateLabel(makeTask({ id: 1, taskStatus: 'todo' }), translate)).toBeNull();
  });

  it('returns null for tasks that are not in doing', () => {
    expect(stateLabel(makeTask({ id: 1, taskStatus: 'todo' }))).toBeNull();
    expect(stateLabel(makeTask({ id: 1, taskStatus: 'done' }))).toBeNull();
  });
});
