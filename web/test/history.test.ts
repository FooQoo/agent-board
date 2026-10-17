import { describe, expect, it } from 'vitest';
import { historyItems } from '../src/lib/history';
import type { HistoryEvent } from '../src/types';

const events: HistoryEvent[] = [
  { at: '2026-10-02T09:48:00Z', reason: 'Created task in Todo.' },
  { at: '2026-10-01T16:30:00Z', reason: 'Started implementation after approval.' },
  { at: '2026-10-01T16:30:00Z', reason: 'Started implementation after approval.' },
];

describe('historyItems', () => {
  it('reverses insertion order, preserving duplicate times and reasons without changing the input', () => {
    const before = structuredClone(events);
    expect(historyItems(events)).toEqual([events[2], events[1], events[0]]);
    expect(events).toEqual(before);
  });

  it('preserves free work notes as only datetime and reason, without inferring status or actor', () => {
    const note = {
      at: '2026-10-02T10:00:00Z',
      reason: 'AI checked Pending work.\nNo status change needed.',
    };
    expect(historyItems([note])).toEqual([note]);
  });

  it('returns an empty list for no history', () => {
    expect(historyItems([])).toEqual([]);
  });
});
