import { BookOpenIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SettingsEntryRow } from '@/shared/ui/settings-entry-row';

/** The row the settings dialog shows to start the guide again on the board. */
export function TutorialEntryRow({ onStart }: { onStart: () => void }) {
  const { t } = useTranslation();
  return (
    <SettingsEntryRow
      icon={BookOpenIcon}
      title={t('settings.tutorial.title')}
      body={t('settings.tutorial.body')}
      action={t('settings.tutorial.action')}
      onOpen={onStart}
    />
  );
}
