import { useCallback, useEffect, useState } from 'react';
import { parseAsInteger, parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';
import type { MonitorCard, MonitorFreshness, MonitorScope } from '../contracts';
import type { Project, ProjectId } from '../../types';

const monitorUrlState = {
  project: parseAsString,
  cardProject: parseAsString,
  card: parseAsInteger,
  tab: parseAsStringLiteral(['body', 'history'] as const),
};

export function useMonitorUrl(
  projects: Project[],
  catalogReady: boolean,
  cards: MonitorCard[],
  failedProjectIds: MonitorFreshness['failedProjectIds'],
) {
  const [query, setQuery] = useQueryStates(monitorUrlState, { history: 'push', shallow: true });
  const [notice, setNotice] = useState(false);
  const scope: MonitorScope =
    query.project && projects.some(({ id }) => id === query.project) ? query.project : 'all';
  const selected: MonitorCard | null =
    query.cardProject && query.card !== null
      ? (cards.find(
          ({ projectId, card }) => projectId === query.cardProject && card.id === query.card,
        ) ?? null)
      : null;
  const tab = query.tab ?? 'body';

  useEffect(() => {
    if (!catalogReady) return;
    const validScope = query.project === null || projects.some(({ id }) => id === query.project);
    const hasDetailQuery = query.cardProject !== null || query.card !== null || query.tab !== null;
    const detailProject = query.cardProject
      ? projects.find(({ id }) => id === query.cardProject)
      : null;
    if (query.cardProject && failedProjectIds.includes(query.cardProject)) return;
    const invalidDetail =
      hasDetailQuery &&
      (!detailProject ||
        query.card === null ||
        query.card < 1 ||
        (query.project !== null && query.project !== query.cardProject) ||
        !cards.some(
          ({ projectId, card }) => projectId === query.cardProject && card.id === query.card,
        ));
    if (!validScope || invalidDetail) {
      setNotice(true);
      void setQuery(
        {
          project: validScope ? query.project : null,
          cardProject: null,
          card: null,
          tab: null,
        },
        { history: 'replace' },
      );
    }
  }, [catalogReady, cards, failedProjectIds, projects, query, setQuery]);

  const onScopeChange = useCallback(
    (next: MonitorScope) => {
      setNotice(false);
      void setQuery({
        project: next === 'all' ? null : next,
        cardProject: null,
        card: null,
        tab: null,
      });
    },
    [setQuery],
  );

  const onCardSelect = useCallback(
    (projectId: ProjectId, cardId: number) => {
      setNotice(false);
      void setQuery({ cardProject: projectId, card: cardId, tab: 'body' });
    },
    [setQuery],
  );

  const onCloseCard = useCallback(() => {
    void setQuery({ cardProject: null, card: null, tab: null }, { history: 'replace' });
  }, [setQuery]);

  const onTabChange = useCallback(
    (next: 'body' | 'history') => {
      void setQuery({ tab: next });
    },
    [setQuery],
  );

  return { scope, selected, tab, notice, onScopeChange, onCardSelect, onCloseCard, onTabChange };
}
