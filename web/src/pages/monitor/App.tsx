import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { monitorReadResolvers } from './client';
import type { MonitorViewProps } from './contracts';
import { MonitorView } from './View';
import { createMonitorFixtureProps } from './mock';
import { monitorFreshnessForStream, useMonitor } from './hooks/useMonitor';
import { useMonitorEvents } from './hooks/useMonitorEvents';
import { useMonitorUrl } from './hooks/useMonitorUrl';
import { selectMonitorTasks } from './model/select';
import { useMonitorInteractions } from './hooks/useMonitorInteractions';
import { monitorClient } from './client';
import { monitorPreferences } from './preferences';
import { syncPreferences } from '../../shared/preferences';
import { ConnectionStateView } from './connection/ConnectionStateView';
import { useMonitorConnection } from './hooks/useMonitorConnection';

/** A hook that reloads the page for a newer build (`served`), unless the page is `busy`. The entry supplies it. */
export type BuildReloadHook = (served: string | null, busy: boolean) => void;

export function App({ useBuildReload }: { useBuildReload: BuildReloadHook }) {
  return import.meta.env.MODE === 'mock' ? (
    <MonitorFixtureApp />
  ) : (
    <MonitorConnectedApp useBuildReload={useBuildReload} />
  );
}

function MonitorFixtureApp() {
  return <MonitorView {...createMonitorFixtureProps()} />;
}

/**
 * Confirms the phone's access before the monitor reads anything. While the session is missing,
 * expired or stopped, no list, event stream or answer runs and no board data is shown: the phone
 * is asked for the passcode instead.
 */
function MonitorConnectedApp({ useBuildReload }: { useBuildReload: BuildReloadHook }) {
  const { t } = useTranslation();
  const connection = useMonitorConnection();
  const { state, unlockFailure } = connection;
  if (state.status === 'checking') return null;
  if (state.status === 'reconnecting') return <ConnectionStateView status="reconnecting" />;
  if (state.status === 'needs_passcode') {
    // What the last passcode got wins over why the screen was shown.
    const message = unlockFailure ?? state.failure;
    return (
      <ConnectionStateView
        status="needs_passcode"
        error={message === null ? null : t(`monitorConnection.phone.failure.${message}`)}
        locked={unlockFailure === 'locked'}
        checking={connection.unlocking}
        onSubmit={(code) => void connection.unlock(code)}
      />
    );
  }
  return <MonitorReadyApp useBuildReload={useBuildReload} />;
}

function MonitorReadyApp({ useBuildReload }: { useBuildReload: BuildReloadHook }) {
  const monitor = useMonitor();
  // The session is live here: show the language and theme saved on the PC (the copy painted first).
  useEffect(() => {
    void syncPreferences(monitorPreferences);
  }, []);
  const answers = useMonitorInteractions({
    writeAnswer: monitorClient.answerRequest,
  });
  const refresh = useCallback(() => monitor.refresh(), [monitor.refresh]);
  const events = useMonitorEvents({
    onRefresh: refresh,
    onVisibility: monitor.onVisibility,
  });
  // A reload would drop an open drawer, and a drag in it, so it waits until the drawer is closed.
  const [detailOpen, setDetailOpen] = useState(false);
  useBuildReload(events.build, answers.locked || detailOpen);
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
    onDetailOpenChange: setDetailOpen,
  };
  return <MonitorView {...props} />;
}
