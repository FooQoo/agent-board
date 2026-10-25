import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createMonitorAdapter, monitorClient } from './client';
import { MonitorProject, type BuildReloadHook } from './MonitorProject';
import { createMonitorFixture } from './mock';
import { createMonitorFixtureAdapter } from './mock-adapter';
import { useMonitorUrl } from './hooks/useMonitorUrl';
import { ConnectionStateView } from './connection/ConnectionStateView';
import { ProjectErrorView } from './connection/ProjectErrorView';
import { useMonitorConnection } from './hooks/useMonitorConnection';

export type { BuildReloadHook } from './MonitorProject';

export function App({ useBuildReload }: { useBuildReload: BuildReloadHook }) {
  return import.meta.env.MODE === 'mock' ? (
    <MonitorFixtureApp useBuildReload={useBuildReload} />
  ) : (
    <MonitorRoutedApp useBuildReload={useBuildReload} />
  );
}

function MonitorFixtureApp({ useBuildReload }: { useBuildReload: BuildReloadHook }) {
  const fixture = useMemo(() => createMonitorFixture(), []);
  const adapter = useMemo(() => createMonitorFixtureAdapter(fixture), [fixture]);
  return (
    <MonitorProject
      projectId={fixture.projectId}
      adapter={adapter}
      writeAnswer={async () => {
        throw new Error('The sample data cannot take an answer.');
      }}
      useBuildReload={useBuildReload}
      onNotFound={() => undefined}
    />
  );
}

/**
 * The address names the project: `/monitor/?project={projectId}`. Without a valid one the error
 * screen is all there is, and nothing is asked of the server, so no project is read by default.
 */
function MonitorRoutedApp({ useBuildReload }: { useBuildReload: BuildReloadHook }) {
  const route = useMonitorUrl();
  if (route.status !== 'ok') return <ProjectErrorView kind={route.status} />;
  return <MonitorConnectedApp projectId={route.projectId} useBuildReload={useBuildReload} />;
}

/**
 * Confirms the phone's access before the monitor reads anything. While the session is missing,
 * expired or stopped, no Summary, event stream or answer runs and no board data is shown: the
 * phone is asked for the passcode instead. The project in the address is kept throughout.
 */
function MonitorConnectedApp({
  projectId,
  useBuildReload,
}: {
  projectId: string;
  useBuildReload: BuildReloadHook;
}) {
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
  return <MonitorReadyApp projectId={projectId} useBuildReload={useBuildReload} />;
}

function MonitorReadyApp({
  projectId,
  useBuildReload,
}: {
  projectId: string;
  useBuildReload: BuildReloadHook;
}) {
  const adapter = useMemo(() => createMonitorAdapter(projectId), [projectId]);
  const [gone, setGone] = useState(false);
  const onNotFound = useCallback(() => setGone(true), []);
  // The project was deleted: the error screen takes the place of the monitor, and its stream ends.
  if (gone) return <ProjectErrorView kind="notFound" />;
  return (
    <MonitorProject
      projectId={projectId}
      adapter={adapter}
      writeAnswer={monitorClient.answerRequest}
      useBuildReload={useBuildReload}
      onNotFound={onNotFound}
    />
  );
}
