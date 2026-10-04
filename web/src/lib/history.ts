import type { ColumnName, HistoryEvent } from '../types';

export interface HistoryItem {
  id: number;
  cardStatus: ColumnName;
  statusKind: 'card' | 'agent';
  status: ColumnName | import('../types').RunState;
  actor: 'ai' | 'human';
  reason: string | null;
  created: boolean;
  at: string;
}

/** One status label per event, newest first. */
export function historyItems(events: HistoryEvent[]): HistoryItem[] {
  return [...events].reverse().map((event) => ({
    id: event.id,
    cardStatus: event.toCardStatus,
    statusKind: event.kind === 'agent' ? 'agent' : 'card',
    status: event.kind === 'agent' ? event.toAgentStatus : event.toCardStatus,
    actor: event.actor,
    reason: event.reason,
    created: event.kind === 'created',
    at: event.at,
  }));
}
