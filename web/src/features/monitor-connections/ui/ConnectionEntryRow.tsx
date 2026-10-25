import { SmartphoneIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SettingsEntryRow } from '@/shared/ui/settings-entry-row';

/** The row the settings dialog shows to open the connection dialog. */
export function ConnectionEntryRow({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <SettingsEntryRow
      icon={SmartphoneIcon}
      title={t('monitorConnection.entryTitle')}
      body={t('monitorConnection.entryBody')}
      action={t('monitorConnection.entryAction')}
      onOpen={onOpen}
    />
  );
}
