import type { MonitorCard, MonitorScope } from '../contracts';

/** Select each active card once by board lane, regardless of owner or agent run state. */
export function selectMonitorCards(cards: readonly MonitorCard[], scope: MonitorScope) {
  const active = cards.filter(
    ({ projectId, card }) => (scope === 'all' || projectId === scope) && !card.archivedAt,
  );
  return {
    todo: active.filter(({ card }) => card.cardStatus === 'todo'),
    doing: active.filter(({ card }) => card.cardStatus === 'doing'),
    done: active.filter(({ card }) => card.cardStatus === 'done'),
  };
}
