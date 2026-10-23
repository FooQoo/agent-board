import { RefreshCwIcon, TriangleAlertIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { ConfirmPanel } from '@/shared/ui/confirm-panel';
import { DialogActions } from '@/shared/ui/dialog-actions';
import './document.css';
import '@/shared/i18n/docs-strings';

export interface ConflictBannerProps {
  /** Loads the latest file. Asked to confirm first: it throws the edit away. */
  onReload: () => void;
  /** Saves the edit over the latest file. No question: the edit is what the person chose to keep. */
  onOverwrite: () => void;
  /** A save or a reload is under way. */
  busy?: boolean;
}

/**
 * The notice that the file changed on disk after it was opened. The edit stays in the editor
 * below; the person picks the latest file or their own content.
 */
export function ConflictBanner({ onReload, onOverwrite, busy = false }: ConflictBannerProps) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="docs-conflict" role="alert">
      <div className="docs-conflict__row">
        <TriangleAlertIcon aria-hidden="true" className="docs-conflict__icon" />
        <div className="docs-conflict__text">
          <strong className="docs-conflict__title">{t('docsDocument.conflictTitle')}</strong>
          <span className="docs-conflict__body">{t('docsDocument.conflictBody')}</span>
        </div>
        <DialogActions size="s" className="docs-conflict__actions">
          <Button
            type="button"
            variant="outline"
            disabled={busy || confirming}
            onClick={() => setConfirming(true)}
          >
            <RefreshCwIcon aria-hidden="true" />
            {t('docsDocument.conflictReload')}
          </Button>
          <Button type="button" disabled={busy || confirming} onClick={onOverwrite}>
            {busy ? t('docsDocument.conflictOverwriting') : t('docsDocument.conflictOverwrite')}
          </Button>
        </DialogActions>
      </div>
      {confirming && (
        <ConfirmPanel
          focusOnMount
          title={t('docsDocument.reloadConfirmTitle')}
          message={t('docsDocument.reloadConfirmBody')}
          confirmLabel={t('docsDocument.reloadConfirm')}
          cancelLabel={t('docsDocument.reloadCancel')}
          busy={busy}
          onConfirm={() => {
            setConfirming(false);
            onReload();
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
