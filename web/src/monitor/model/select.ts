import type { MonitorCard, MonitorScope } from '../contracts';

/** Select the active projects' cards without archived items, grouped by monitor status. */
export function selectMonitorCards(cards: readonly MonitorCard[], scope: MonitorScope) {
  const active = cards.filter(
    ({ projectId, card }) => (scope === 'all' || projectId === scope) && !card.archivedAt,
  );
  return {
    pending: active.filter(({ card }) => card.agentStatus === 'pending'),
    running: active.filter(({ card }) => card.agentStatus === 'running'),
    done: active.filter(({ card }) => card.cardStatus === 'done'),
  };
}
