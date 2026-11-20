import { describe, expect, it } from 'vitest';
import { parseSummaries, windowLabel } from './messages';

describe('windowLabel', () => {
  it('shows the day once for a window inside one day (TZ=UTC)', () => {
    expect(windowLabel('2026-11-20T09:00:00Z', '2026-11-20T10:00:00Z')).toBe('11/20 09:00–10:00');
  });

  it('names the second day when the window crosses midnight', () => {
    expect(windowLabel('2026-11-20T23:30:00Z', '2026-11-21T00:00:00Z')).toBe(
      '11/20 23:30–11/21 00:00',
    );
  });

  it('shows a time that cannot be read as it was written', () => {
    expect(windowLabel('soon', 'later')).toBe('soon–later');
  });
});

describe('parseSummaries', () => {
  const entry = {
    id: 's-1',
    dismissed: false,
    from: '2026-11-20T09:00:00Z',
    to: '2026-11-20T10:00:00Z',
    results: [{ taskId: 552, title: 'Pull to refresh', at: '2026-11-20T09:10:00Z' }, { bad: 1 }],
  };

  it('keeps the window and the well formed results', () => {
    expect(parseSummaries({ summaries: [entry] })).toEqual([
      {
        id: 's-1',
        from: entry.from,
        to: entry.to,
        results: [{ taskId: 552, title: 'Pull to refresh' }],
      },
    ]);
  });

  it('leaves out a dismissed entry and one that is not well formed', () => {
    expect(
      parseSummaries({ summaries: [{ ...entry, dismissed: true }, { id: 'x' }, null] }),
    ).toEqual([]);
  });

  it('rejects a response without the list', () => {
    expect(() => parseSummaries({})).toThrow(TypeError);
  });
});
