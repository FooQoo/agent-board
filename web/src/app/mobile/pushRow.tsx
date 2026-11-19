import { PushEntryRow } from '../../features/push-notifications/ui/PushEntryRow';
import { usePushNotifications } from '../../features/push-notifications/usePushNotifications';
import { usesRemoteSession } from '../remote/session';

/** The row wired to the PC. Only a page that came through the remote entrance has one. */
export function PushSettingsRow() {
  if (!usesRemoteSession()) return null;
  return <RemotePushRow />;
}

function RemotePushRow() {
  const push = usePushNotifications();
  if (push.view === 'hidden') return null;
  return (
    <PushEntryRow
      view={push.view}
      support={push.support}
      busy={push.busy}
      failed={push.failed}
      onEnable={push.enable}
      onDisable={push.disable}
    />
  );
}
