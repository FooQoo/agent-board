import { useCallback, useEffect, useState } from 'react';
import { parseAsString, useQueryStates } from 'nuqs';
import type { MonitorScope } from '../contracts';
import type { Project } from '../../types';

const monitorUrlState = {
  project: parseAsString,
  cardProject: parseAsString,
  card: parseAsString,
  tab: parseAsString,
};

export function useMonitorUrl(projects: Project[], catalogReady: boolean) {
  const [query, setQuery] = useQueryStates(monitorUrlState, { history: 'push', shallow: true });
  const [notice, setNotice] = useState(false);
  const scope: MonitorScope =
    query.project && projects.some(({ id }) => id === query.project) ? query.project : 'all';

  useEffect(() => {
    if (!catalogReady) return;
    const validScope = query.project === null || projects.some(({ id }) => id === query.project);
    const hasDetailQuery = query.cardProject !== null || query.card !== null || query.tab !== null;
    if (!validScope) setNotice(true);
    if (!validScope || hasDetailQuery) {
      void setQuery(
        { project: validScope ? query.project : null, cardProject: null, card: null, tab: null },
        { history: 'replace' },
      );
    }
  }, [catalogReady, projects, query, setQuery]);

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

  return { scope, notice, onScopeChange };
}
