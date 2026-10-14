import type { HistoryEvent } from '../types';

/** Preserve each recorded note, newest first by insertion order. */
export function historyItems(events: HistoryEvent[]): HistoryEvent[] {
  return [...events].reverse();
}
