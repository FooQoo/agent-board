import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import './StalePageNotice.css';

/**
 * Shown when the server was restarted and this page holds an old token: its writes are refused, so the person
 * reloads the page to continue. The text says that anything typed here is lost on reload.
 */
export function StalePageNotice() {
  const { t } = useTranslation();
  // Rendered at the body, above any open dialog, so that it can be reached while a dialog is open.
  return createPortal(
    <div className="stale-page" role="alert">
      <div className="stale-page__text">
        <strong>{t('stalePage.title')}</strong>
        <span>{t('stalePage.body')}</span>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()}>
        {t('stalePage.reload')}
      </Button>
    </div>,
    document.body,
  );
}
