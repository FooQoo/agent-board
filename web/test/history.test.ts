import { describe, expect, it } from 'vitest';
import { historyItems } from '../src/lib/history';
import type { HistoryEvent } from '../src/types';

const events: HistoryEvent[] = [
  {
    id: '1',
    kind: 'created',
    actor: 'ai',
    reason: null,
    fromCardStatus: null,
    toCardStatus: 'todo',
    fromAgentStatus: null,
    toAgentStatus: 'idle',
    requestId: null,
    at: '2026-10-01T16:00:00Z',
  },
  {
    id: '2',
    kind: 'lane',
    actor: 'human',
    reason: 'Start implementation',
    fromCardStatus: 'todo',
    toCardStatus: 'doing',
    fromAgentStatus: 'idle',
    toAgentStatus: 'idle',
    requestId: null,
    at: '2026-10-01T16:30:00Z',
  },
  {
    id: '3',
    kind: 'agent',
    actor: 'ai',
    reason: 'Need a decision',
    fromCardStatus: 'doing',
    toCardStatus: 'doing',
    fromAgentStatus: 'idle',
    toAgentStatus: 'pending',
    requestId: '0123456789abcdef0123456789abcdef',
    at: '2026-10-02T09:48:00Z',
  },
];

describe('historyItems', () => {
  it('uses one changed status label per event, newest first, with actor and reason', () => {
    const items = historyItems(events);
    expect(items.map((item) => [item.statusKind, item.status])).toEqual([
      ['agent', 'pending'],
      ['card', 'doing'],
      ['card', 'todo'],
    ]);
    expect(items.map((item) => item.cardStatus)).toEqual(['doing', 'doing', 'todo']);
    expect(items.map((item) => item.actor)).toEqual(['ai', 'human', 'ai']);
    expect(items.map((item) => item.reason)).toEqual([
      'Need a decision',
      'Start implementation',
      null,
    ]);
    expect(items.map((item) => item.created)).toEqual([false, false, true]);
  });

  it('shows an answer as the idle state with the chosen option and the text', () => {
    const answered: HistoryEvent = {
      id: '4',
      kind: 'answer',
      actor: 'human',
      reason: 'Because of the layout',
      fromCardStatus: 'doing',
      toCardStatus: 'doing',
      fromAgentStatus: 'pending',
      toAgentStatus: 'idle',
      requestId: '0123456789abcdef0123456789abcdef',
      choiceId: 'keep',
      choiceLabel: 'Keep the data',
      at: '2026-10-02T10:00:00Z',
    };
    const [item] = historyItems([answered]);
    expect(item).toMatchObject({
      statusKind: 'agent',
      status: 'idle',
      choice: 'Keep the data',
      reason: 'Because of the layout',
    });
  });

  it('returns an empty list for no history', () => {
    expect(historyItems([])).toEqual([]);
  });
});
