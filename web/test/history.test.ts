import { describe, expect, it } from 'vitest';
import { historyItems } from '../src/lib/history';
import type { Transition } from '../src/types';

const t = (from: Transition['from'], to: Transition['to'], at: string): Transition => ({ from, to, at });

describe('historyItems', () => {
  it('returns a semantic creation marker without localized display text', () => {
    expect(historyItems([t(null, 'todo', '2026-10-01T16:00:00Z')])).toEqual([
      { column: 'todo', created: true, at: '2026-10-01T16:00:00Z' },
    ]);
  });

  it('adds one point per transition from Todo to Doing to Done', () => {
    const items = historyItems([
      t(null, 'todo', '2026-10-01T16:00:00Z'),
      t('todo', 'doing', '2026-10-01T16:30:00Z'),
      t('doing', 'done', '2026-10-02T09:48:00Z'),
    ]);
    expect(items).toEqual([
      { column: 'todo', created: true, at: '2026-10-01T16:00:00Z' },
      { column: 'doing', created: false, at: '2026-10-01T16:30:00Z' },
      { column: 'done', created: false, at: '2026-10-02T09:48:00Z' },
    ]);
  });

  it('adds a point when a card returns to a column it was in before', () => {
    const items = historyItems([
      t(null, 'todo', '2026-10-01T16:00:00Z'),
      t('todo', 'doing', '2026-10-01T16:30:00Z'),
      t('doing', 'todo', '2026-10-01T17:00:00Z'),
      t('todo', 'doing', '2026-10-01T18:00:00Z'),
    ]);
    expect(items.map((i) => i.column)).toEqual(['todo', 'doing', 'todo', 'doing']);
    expect(items.map((i) => i.created)).toEqual([true, false, false, false]);
  });

  it('keeps the order of the input (oldest first)', () => {
    const items = historyItems([
      t(null, 'todo', '2026-10-01T16:00:00Z'),
      t('todo', 'doing', '2026-10-01T16:30:00Z'),
    ]);
    expect(items.map((i) => i.at)).toEqual(['2026-10-01T16:00:00Z', '2026-10-01T16:30:00Z']);
  });

  it('returns an empty list for no transitions', () => {
    expect(historyItems([])).toEqual([]);
  });
});
