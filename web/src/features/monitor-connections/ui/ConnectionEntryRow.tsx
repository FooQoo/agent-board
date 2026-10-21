import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import './connection.css';

/** The row the settings dialog shows to open the connection dialog. */
export function ConnectionEntryRow({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="connection-entry" aria-labelledby="connection-entry-title">
      <div className="connection-entry__copy">
        <h3 id="connection-entry-title" className="connection-entry__title">
          {t('monitorConnection.entryTitle')}
        </h3>
        <p className="connection-entry__body">{t('monitorConnection.entryBody')}</p>
      </div>
      <Button type="button" variant="outline" onClick={onOpen}>
        {t('monitorConnection.entryAction')}
      </Button>
    </section>
  );
}
