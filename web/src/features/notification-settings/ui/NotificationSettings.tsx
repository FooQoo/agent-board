import { useNotificationSettings } from '../useNotificationSettings';
import { NotificationSettingsView } from './NotificationSettingsView';

/** The "Phone notifications" section wired to the board's own `/api/notification-settings`. */
export function NotificationSettings() {
  const { state, change } = useNotificationSettings();
  return <NotificationSettingsView state={state} onChange={change} />;
}
