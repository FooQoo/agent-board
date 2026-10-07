import { CircleAlertIcon, XIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { findCardButton } from '../DialogFrame';
import '../../styles/editor.css';

export interface EditorShellProps {
  /** `#14` — shown before the title when the dialog is about an existing card. */
  cardId?: number;
  title: string;
  badge: string;
  variant: 'edit' | 'create';
  /** There are unsaved changes: closing asks first. */
  dirty: boolean;
  saving: boolean;
  /** The save failed: shown above the footer. */
  error: string | null;
  onRetry?: () => void;
  /** The dialog is done: saved, or closed. */
  onClose: () => void;
  /** The line at the left of the footer. */
  status?: string;
  /** The buttons at the right of the footer, after Cancel. */
  actions: ReactNode;
  children: ReactNode;
}

/** The large dialog of the editor: header, body, error line and footer, plus the discard question. */
export function EditorShell({
  cardId,
  title,
  badge,
  variant,
  dirty,
  saving,
  error,
  onRetry,
  onClose,
  status,
  actions,
  children,
}: EditorShellProps) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  // Where the focus was when the dialog opened (the button that opened it).
  const [opener] = useState(() => document.activeElement);

  const requestClose = () => {
    if (saving) return;
    if (dirty) setAsking(true);
    else onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && requestClose()}>
      <DialogContent
        className={`editor-dialog editor-dialog--${variant}`}
        showCloseButton={false}
        aria-describedby={undefined}
        // A click on the backdrop must not throw away what was typed into a new card; for an
        // existing draft it goes through the same unsaved-changes question as Cancel.
        onPointerDownOutside={(event) => variant === 'create' && event.preventDefault()}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          event.currentTarget instanceof HTMLElement &&
            event.currentTarget.querySelector<HTMLElement>('input')?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (opener instanceof HTMLElement && opener !== document.body && opener.isConnected) {
            opener.focus();
          } else if (cardId !== undefined) {
            findCardButton(cardId)?.focus();
          }
        }}
      >
        <div className="editor__header">
          <DialogTitle className="editor__heading">
            {cardId !== undefined && <span className="editor__id">#{cardId}</span>}
            <span className="editor__title">{title}</span>
            <span className="editor__badge">{badge}</span>
          </DialogTitle>
          <button
            type="button"
            className="editor__close"
            aria-label={t('dialog.close')}
            disabled={saving}
            onClick={requestClose}
          >
            <XIcon aria-hidden="true" />
          </button>
        </div>
        {children}
        {error !== null && (
          <div className="editor__error" role="alert">
            <CircleAlertIcon aria-hidden="true" />
            <span className="editor__error-text">{error}</span>
            {onRetry && (
              <button type="button" className="editor__retry" disabled={saving} onClick={onRetry}>
                {t('editor.retry')}
              </button>
            )}
          </div>
        )}
        <div className="editor__footer">
          <span className="editor__status" role="status">
            {status}
          </span>
          <button type="button" className="editor__btn" disabled={saving} onClick={requestClose}>
            {t('dialog.cancel')}
          </button>
          {actions}
        </div>
        <Dialog open={asking} onOpenChange={setAsking}>
          <DialogContent
            className="editor-confirm"
            showCloseButton={false}
            aria-describedby="editor-confirm-body"
          >
            <DialogTitle className="editor-confirm__title">{t('editor.discardTitle')}</DialogTitle>
            <p className="editor-confirm__body" id="editor-confirm-body">
              {t('editor.discardBody')}
            </p>
            <div className="editor-confirm__actions">
              <button type="button" className="editor__btn" onClick={() => setAsking(false)}>
                {t('editor.keepEditing')}
              </button>
              <button
                type="button"
                className="editor__btn editor__btn--danger"
                onClick={() => {
                  setAsking(false);
                  onClose();
                }}
              >
                {t('editor.discard')}
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
