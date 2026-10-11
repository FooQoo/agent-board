import type { MonitorViewProps } from './contracts';
import { MonitorView } from './View';
import { unconnectedMonitorReadResolvers } from './contracts';
import { createMonitorFixtureProps } from './mock';

const initialProps: MonitorViewProps =
  import.meta.env.MODE === 'mock'
    ? createMonitorFixtureProps()
    : {
        projects: [],
        scope: 'all',
        summary: null,
        pending: [],
        running: [],
        done: [],
        selectedCard: null,
        body: null,
        history: null,
        freshness: {
          state: 'loading',
          lastFetchedAt: null,
          failedProjectIds: [],
          snapshotProblems: [],
        },
        readResolvers: unconnectedMonitorReadResolvers,
        onScopeChange: () => undefined,
        onCardSelect: () => undefined,
        onCloseCard: () => undefined,
        onTabChange: () => undefined,
        onRefresh: () => undefined,
      };

export function App() {
  return <MonitorView {...initialProps} />;
}
