import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import './tutorial.css';

/** The row the settings dialog shows to start the guide again on the board. */
export function TutorialEntryRow({ onStart }: { onStart: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="tutorial-entry" aria-labelledby="tutorial-entry-title">
      <div className="tutorial-entry__copy">
        <h3 id="tutorial-entry-title" className="tutorial-entry__title">
          {t('settings.tutorial.title')}
        </h3>
        <p className="tutorial-entry__body">{t('settings.tutorial.body')}</p>
      </div>
      <Button type="button" variant="outline" onClick={onStart}>
        {t('settings.tutorial.action')}
      </Button>
    </section>
  );
}
