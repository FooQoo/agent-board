import { BellIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SettingsEntryRow } from '@/shared/ui/settings-entry-row';

/** The row the settings dialog shows to open the phone notification dialog (the same row as the remote connection). */
export function NotificationEntryRow({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <SettingsEntryRow
      icon={BellIcon}
      title={t('notifications.title')}
      body={t('notifications.entryBody')}
      action={t('notifications.entryAction')}
      onOpen={onOpen}
    />
  );
}
