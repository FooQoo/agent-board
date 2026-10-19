import { CircleAlertIcon, XIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/dialog';
import { findTaskButton } from '../dialog-frame/DialogFrame';
import { DiscardConfirm } from './DiscardConfirm';
import '../../styles/editor.css';
import './editor-common.css';
import '../../styles/rich-table.css';
import '../../styles/rich-body.css';

export interface EditorShellProps {
  /** `#14` — shown before the title when the dialog is about an existing card. */
  taskId?: number;
  /** Shown before the title instead of `#taskId`, for an epic (its EPIC-ID). */
  idLabel?: string;
  /** The label the focus returns to when the dialog closes, if the opener is gone. */
  returnFocusSelector?: string;
  title: string;
  badge: string;
  variant: 'edit' | 'create';
  /** There are unsaved changes: closing asks first. */
  dirty: boolean;
  saving: boolean;
  /** The save failed: the band above the footer says so and offers Retry. */
  error: string | null;
  onRetry?: () => void;
  /** The text is over the limit: the band above the footer says how much to remove. */
  overLimit?: { message: string; count: string } | null;
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

/**
 * The large dialog of the editor: header, body, the error and over-limit bands above the footer,
 * and the footer with its buttons, plus the discard question.
 */
export function EditorShell({
  taskId,
  idLabel,
  returnFocusSelector,
  title,
  badge,
  variant,
  dirty,
  saving,
  error,
  onRetry,
  overLimit = null,
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

  const shownId = idLabel ?? (taskId !== undefined ? `#${taskId}` : undefined);

  return (
    <Dialog open onOpenChange={(open) => !open && requestClose()}>
      <DialogContent
        className={`editor-dialog editor-dialog--${variant}`}
        showCloseButton={false}
        aria-describedby={undefined}
        // A click on the backdrop must not throw away what was typed into a new card; for an
        // existing draft it goes through the same unsaved-changes question as Cancel.
        // While an enlarged picture is open, Escape closes only that picture, not the dialog.
        onEscapeKeyDown={(event) => {
          const close = document.querySelector<HTMLElement>('[data-lightbox] .lightbox__close');
          if (close === null) return;
          event.preventDefault();
          close.click();
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
          } else if (taskId !== undefined) {
            findTaskButton(taskId)?.focus();
          }
        }}
      >
        <div className="editor__header">
          <DialogTitle className="editor__heading">
            {shownId !== undefined && <span className="editor__id">{shownId}</span>}
            <span className="editor__title">{title}</span>
            <span className="editor__badge">{badge}</span>
          </DialogTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="editor__close"
            aria-label={t('dialog.close')}
            disabled={saving}
            onClick={requestClose}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </div>
        {children}
        {error !== null && (
          <div className="editor__error" role="alert">
            <CircleAlertIcon aria-hidden="true" />
            <span className="editor__error-text">{error}</span>
            {onRetry && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="editor__retry"
                disabled={saving}
                onClick={onRetry}
              >
                {t('editor.retry')}
              </Button>
            )}
          </div>
        )}
        {overLimit !== null && (
          <div className="editor__limit" role="status">
            <CircleAlertIcon aria-hidden="true" />
            <span className="editor__limit-text">{overLimit.message}</span>
            <span className="editor__limit-count">{overLimit.count}</span>
          </div>
        )}
        <div className="editor__footer" data-saving={saving ? 'true' : undefined}>
          {footerStart}
          <span className="editor__status" role="status">
            {saving ? t('editor.savingStatus') : status}
          </span>
          <Button type="button" variant="outline" disabled={saving} onClick={requestClose}>
            {t('dialog.cancel')}
          </Button>
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
