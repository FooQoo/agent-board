import { useState } from 'react';
import { PushPromptDialogView } from '../../features/push-notifications/ui/PushPromptDialogView';
import { usePushNotifications } from '../../features/push-notifications/usePushNotifications';
import {
  readPromptDismissed,
  rememberPromptDismissed,
  shouldPromptForPush,
} from '../../features/push-notifications/state';
import { usesRemoteSession } from '../remote/session';

/**
 * Asks, once per device, to turn notifications on when the board is opened from the Home Screen
 * and nothing has been decided yet. Results are on by default, so the permission is the only step.
 */
export function PushPromptHost() {
  if (!usesRemoteSession()) return null;
  return <RemotePushPrompt />;
}

function RemotePushPrompt() {
  const push = usePushNotifications();
  const [dismissed, setDismissed] = useState(readPromptDismissed);
  if (!shouldPromptForPush(push.support, push.permission, push.view, dismissed)) return null;
  const close = () => {
    rememberPromptDismissed();
    setDismissed(true);
  };
  return (
    <PushPromptDialogView
      busy={push.busy}
      failed={push.failed}
      onEnable={() => {
        rememberPromptDismissed();
        push.enable();
      }}
      onClose={close}
    />
  );
}
