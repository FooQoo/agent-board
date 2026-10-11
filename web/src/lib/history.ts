import type { ColumnName, HistoryEvent } from '../types';

export interface HistoryItem {
  id: string;
  cardStatus: ColumnName;
  statusKind: 'card' | 'agent';
  status: ColumnName | import('../types').RunState;
  actor: 'ai' | 'human';
  reason: string | null;
  created: boolean;
  /** The option the person chose, for an answer. */
  choice: string | null;
  at: string;
}

/** One status label per event, newest first. */
export function historyItems(events: HistoryEvent[]): HistoryItem[] {
  return [...events].reverse().map((event) => ({
    id: event.id,
    cardStatus: event.toCardStatus,
    statusKind: event.kind === 'agent' || event.kind === 'answer' ? 'agent' : 'card',
    status:
      event.kind === 'agent' || event.kind === 'answer' ? event.toAgentStatus : event.toCardStatus,
    actor: event.actor,
    reason: event.reason,
    created: event.kind === 'created',
    choice: event.choiceLabel ?? null,
    at: event.at,
  }));
}
