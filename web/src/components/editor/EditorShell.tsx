import { CircleAlertIcon, XIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { findCardButton } from '../DialogFrame';
import { DiscardConfirm } from './DiscardConfirm';
import '../../styles/editor.css';
import '../../styles/editor-epic.css';
import '../../styles/rich-body.css';

export interface EditorShellProps {
  /** `#14` — shown before the title when the dialog is about an existing card. */
  cardId?: number;
  /** Shown before the title instead of `#cardId`, for an epic (its EPIC-ID). */
  idLabel?: string;
  /** The label the focus returns to when the dialog closes, if the opener is gone. */
  returnFocusSelector?: string;
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
  /** The box at the left of the footer, before the status (the draft box of a card or an epic). */
  footerStart?: ReactNode;
  /** The buttons at the right of the footer, after Cancel. */
  actions: ReactNode;
  children: ReactNode;
}

/** The large dialog of the editor: header, body, error line and footer, plus the discard question. */
export function EditorShell({
  cardId,
  idLabel,
  returnFocusSelector,
  title,
  badge,
  variant,
  dirty,
  saving,
  error,
  onRetry,
  onClose,
  status,
  footerStart,
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

  const shownId = idLabel ?? (cardId !== undefined ? `#${cardId}` : undefined);

  return (
    <Dialog open onOpenChange={(open) => !open && requestClose()}>
      <DialogContent
        className={`editor-dialog editor-dialog--${variant}`}
        showCloseButton={false}
        aria-describedby={undefined}
        // A click on the backdrop must not throw away what was typed into a new card; for an
        // existing draft it goes through the same unsaved-changes question as Cancel.
        onEscapeKeyDown={(event) => {
          // Escape belongs to the image viewer while it is open, even if native dialog
          // listeners run before the nested viewer has processed the same key event.
          const imageViewer = document.querySelector('[data-editor-attachment-zoom]');
          if (imageViewer !== null) {
            event.preventDefault();
            imageViewer
              .querySelector<HTMLButtonElement>('[data-editor-attachment-zoom-close]')
              ?.click();
          }
        }}
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
          } else if (returnFocusSelector !== undefined) {
            document.querySelector<HTMLElement>(returnFocusSelector)?.focus();
          } else if (cardId !== undefined) {
            findCardButton(cardId)?.focus();
          }
        }}
      >
        <div className="editor__header">
          <DialogTitle className="editor__heading">
            {shownId !== undefined && <span className="editor__id">{shownId}</span>}
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
          {footerStart}
          <span className="editor__status" role="status">
            {status}
          </span>
          <button type="button" className="editor__btn" disabled={saving} onClick={requestClose}>
            {t('dialog.cancel')}
          </button>
          {actions}
        </div>
        <DiscardConfirm
          open={asking}
          onOpenChange={setAsking}
          onKeep={() => setAsking(false)}
          onDiscard={() => {
            setAsking(false);
            onClose();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
