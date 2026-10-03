import { describe, expect, it } from 'vitest';
import { cardCountLabel, columnLabel, formatShort, formatTime, stateLabel } from '../src/lib/format';
import { makeCard } from './fixtures';

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
  it('uses the singular for exactly one card', () => {
    expect(cardCountLabel(1)).toBe('1 card');
  });

  it('uses the plural otherwise', () => {
    expect(cardCountLabel(0)).toBe('0 cards');
    expect(cardCountLabel(8)).toBe('8 cards');
  });
});

describe('columnLabel', () => {
  it('capitalizes the column names', () => {
    expect(columnLabel('todo')).toBe('Todo');
    expect(columnLabel('doing')).toBe('Doing');
    expect(columnLabel('done')).toBe('Done');
  });
});

describe('stateLabel', () => {
  it('returns the run state label for doing cards', () => {
    expect(stateLabel(makeCard({ id: 1, column: 'doing', run_state: 'idle' }))).toBe('Idle');
    expect(stateLabel(makeCard({ id: 1, column: 'doing', run_state: 'running' }))).toBe('Running');
    expect(stateLabel(makeCard({ id: 1, column: 'doing', run_state: 'pending' }))).toBe('Pending');
  });

  it('returns null for cards that are not in doing', () => {
    expect(stateLabel(makeCard({ id: 1, column: 'todo' }))).toBeNull();
    expect(stateLabel(makeCard({ id: 1, column: 'done' }))).toBeNull();
  });
});
