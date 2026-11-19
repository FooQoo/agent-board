import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ConnectionStateView } from '../../pages/monitor/connection/ConnectionStateView';
import { useMonitorConnection } from '../../pages/monitor/hooks/useMonitorConnection';
import { csrfHeaders, readToken } from '../../shared/api/http';
import { registerServiceWorker } from '../../features/push-notifications/subscribe';
import { syncPreferences } from '../../shared/preferences';
import { openRemoteSession, unlockRemote, usesRemoteSession } from './session';

export { watchSessionLoss } from './session';

/**
 * Holds the board back while the page has no session. Through the ngrok entrance nothing is read
 * until the passcode has been taken, and a lost session brings the passcode screen back. On the
 * local page, which carries its token, it renders the board at once.
 */
export function RemoteGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const connection = useMonitorConnection({
    openSession: openRemoteSession,
    unlock: unlockRemote,
    usesSession: usesRemoteSession,
  });
  const { state, unlockFailure } = connection;
  const ready = state.status === 'ready';
  // The saved language and theme can be read only once there is a session.
  useEffect(() => {
    if (ready && usesRemoteSession())
      void syncPreferences({ url: '/api/preferences', token: readToken, headers: csrfHeaders });
  }, [ready]);
  // The worker lets a phone receive Web Push; the board never depends on it.
  useEffect(() => {
    if (ready && usesRemoteSession()) void registerServiceWorker();
  }, [ready]);
  if (state.status === 'ready') return <>{children}</>;
  if (state.status === 'checking') return null;
  if (state.status === 'reconnecting') return <ConnectionStateView status="reconnecting" />;
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
