import { useCallback } from 'react';
import type { MonitorViewProps } from './contracts';
import { MonitorView } from './View';
import { createMonitorFixtureProps } from './mock';
import { monitorFreshnessForStream, useMonitor } from './hooks/useMonitor';
import { useMonitorEvents } from './hooks/useMonitorEvents';
import { useMonitorUrl } from './hooks/useMonitorUrl';
import { monitorReadResolvers } from './client';
import { selectMonitorCards } from './model/select';

export function App() {
  return import.meta.env.MODE === 'mock' ? <MonitorFixtureApp /> : <MonitorConnectedApp />;
}

function MonitorFixtureApp() {
  return <MonitorView {...createMonitorFixtureProps()} />;
}

function MonitorConnectedApp() {
  const monitor = useMonitor();
  const refresh = useCallback(() => monitor.refresh(), [monitor.refresh]);
  const events = useMonitorEvents({
    onRefresh: refresh,
    onVisibility: monitor.onVisibility,
  });
  const route = useMonitorUrl(
    monitor.projects,
    monitor.catalogReady,
    monitor.cards,
    monitor.freshness.failedProjectIds,
  );
  const grouped = selectMonitorCards(monitor.cards, route.scope);
  const hasPartial =
    monitor.freshness.failedProjectIds.length > 0 || monitor.freshness.snapshotProblems.length > 0;
  const freshness = monitorFreshnessForStream(monitor.freshness, events.state);
  const props: MonitorViewProps = {
    projects: monitor.projects,
    scope: route.scope,
    summary:
      hasPartial || !monitor.hasSnapshot
        ? null
        : {
            pending: grouped.pending.length,
            running: grouped.running.length,
            done: grouped.done.length,
          },
    ...grouped,
    selectedCard: route.selected,
    tab: route.tab,
    body: route.selected?.card.description ?? null,
    history: route.selected?.card.history ?? null,
    freshness,
    routeNotice: route.notice,
    readResolvers: monitorReadResolvers,
    onScopeChange: route.onScopeChange,
    onCardSelect: route.onCardSelect,
    onCloseCard: route.onCloseCard,
    onTabChange: route.onTabChange,
    onRefresh: refresh,
  };
  return <MonitorView {...props} />;
}
