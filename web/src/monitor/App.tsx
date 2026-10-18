import { useCallback, useEffect, useState } from 'react';
import { monitorReadResolvers } from './client';
import type { MonitorViewProps } from './contracts';
import { MonitorView } from './View';
import { createMonitorFixtureProps } from './mock';
import { monitorFreshnessForStream, useMonitor } from './hooks/useMonitor';
import { useMonitorEvents } from './hooks/useMonitorEvents';
import { useMonitorUrl } from './hooks/useMonitorUrl';
import { selectMonitorTasks } from './model/select';
import { useMonitorInteractions } from './hooks/useMonitorInteractions';
import { useBuildReload } from '../hooks/useBuildReload';
import { monitorClient } from './client';

export function App() {
  return import.meta.env.MODE === 'mock' ? <MonitorFixtureApp /> : <MonitorConnectedApp />;
}

function MonitorFixtureApp() {
  return <MonitorView {...createMonitorFixtureProps()} />;
}

function MonitorConnectedApp() {
  const monitor = useMonitor();
  const answers = useMonitorInteractions({ writeAnswer: monitorClient.answerRequest });
  const refresh = useCallback(() => monitor.refresh(), [monitor.refresh]);
  const events = useMonitorEvents({
    onRefresh: refresh,
    onVisibility: monitor.onVisibility,
  });
  useBuildReload(events.build, answers.locked);
  const route = useMonitorUrl(monitor.projects, monitor.catalogReady);
  const [appliedScope, setAppliedScope] = useState(route.scope);
  useEffect(() => {
    answers.reconcileTasks(monitor.tasks);
  }, [answers.reconcileTasks, monitor.tasks]);
  useEffect(() => {
    if (!answers.locked) setAppliedScope(route.scope);
  }, [answers.locked, route.scope]);
  const scope = answers.locked ? appliedScope : route.scope;
  const tasks = answers.tasksWithSavedAnswers(monitor.tasks, monitor.freshness.state === 'fresh');
  const visible = selectMonitorTasks(tasks, scope);
  const hasPartial =
    monitor.freshness.failedProjectIds.length > 0 || monitor.freshness.snapshotProblems.length > 0;
  const freshness = monitorFreshnessForStream(monitor.freshness, events.state);
  const props: MonitorViewProps = {
    projects: monitor.projects,
    scope,
    summary:
      hasPartial || !monitor.hasSnapshot
        ? null
        : {
            todo: visible.todo.length,
            doing: visible.doing.length,
            done: visible.done.length,
          },
    ...visible,
    answerController: {
      ...answers,
      onAnswered: (item, requestId, result) => {
        answers.onAnswered(item, requestId, result);
        monitor.refresh();
      },
    },
    readResolvers: monitorReadResolvers,
    freshness,
    routeNotice: route.notice,
    onScopeChange: route.onScopeChange,
    scopeLocked: answers.locked,
    onRefresh: refresh,
  };
  return <MonitorView {...props} />;
}
