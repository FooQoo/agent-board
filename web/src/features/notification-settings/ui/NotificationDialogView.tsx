import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Surface } from '@/shared/ui/surface/Surface';
import type { NotificationSettingsPatch } from '../model';
import type { NotificationSettingsState } from '../useNotificationSettings';
import { NotificationSettingsView } from './NotificationSettingsView';

/**
 * The dialog the "Phone notifications" row opens: a modal on the PC, a bottom sheet in a narrow
 * window. `push` is the control that turns notifications on for this phone; only a page that came
 * through the remote entrance has one.
 */
export function NotificationDialogView({
  kind,
  onClose,
  state,
  onChange,
  push,
}: {
  kind: 'dialog' | 'sheet';
  onClose: () => void;
  state: NotificationSettingsState;
  onChange: (patch: NotificationSettingsPatch) => void;
  push?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Surface
      kind={kind}
      title={t('notifications.title')}
      closeLabel={t('dialog.close')}
      onClose={onClose}
      className="notification-surface"
    >
      {push ? <div className="settings__entries notification-surface__push">{push}</div> : null}
      <NotificationSettingsView state={state} onChange={onChange} />
    </Surface>
  );
}
