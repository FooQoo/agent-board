import { requestNotificationDialog } from '../features/notification-settings/events';
import { NotificationEntryRow } from '../features/notification-settings/ui/NotificationEntryRow';
import { NotificationHost } from '../features/notification-settings/ui/NotificationHost';
import { PushPromptHost } from './mobile/pushPrompt';
import { PushSettingsRow } from './mobile/pushRow';

/** The sample-data mode and the demo have no server, so they save no notification choices. */
const serverless = import.meta.env.MODE === 'mock' || import.meta.env.MODE === 'demo';

/**
 * The dialog the settings row opens, for the PC and the phone alike. On the phone's Home Screen
 * app it also holds the control that turns notifications on for the phone.
 */
export function NotificationDialogHost() {
  if (serverless) return null;
  return (
    <>
      <NotificationHost push={<PushSettingsRow />} />
      <PushPromptHost />
    </>
  );
}

/** The settings row that opens the notification dialog. It closes the settings dialog first, so only one is on the screen. */
export function NotificationSettingsRow({ onClose }: { onClose: () => void }) {
  if (serverless) return null;
  return (
    <NotificationEntryRow
      onOpen={() => {
        onClose();
        requestNotificationDialog();
      }}
    />
  );
}
