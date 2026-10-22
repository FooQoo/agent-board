import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { XIcon } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { DialogActions } from '@/shared/ui/dialog-actions';
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/dialog';
import { DiscardConfirm } from '../editor/DiscardConfirm';
import '../../styles/modal.css';

/** The button of a card on the board (the focus target after a drag-and-drop move). */
export function findTaskButton(id: number): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>('button.card')) {
    if (element.querySelector('.card__id')?.textContent === `#${id}`) return element;
  }
  return null;
}

export interface DialogFrameProps {
  title: string;
  submitLabel: string;
  /** The card the dialog is about; focus returns to its tile when the opener is gone. */
  taskId?: number;
  /** The dialog is done: saved, or cancelled. */
  onClose: () => void;
  /** Reports that a save started (`true`) or failed and the input was kept (`false`). */
  onSavingChange?: (saving: boolean) => void;
  /** Returns an error message when the input cannot be saved, otherwise null. */
  validate: () => string | null;
  /** Saves. A rejection keeps the dialog open and shows its message. */
  save: () => Promise<void>;
  /** Asks before closing or changing dialog when the form has unsaved input. */
  dirty?: boolean;
  /** Optional content below the form fields and above the action row. */
  footerNote?: ReactNode;
  /** Places a save error inside the footer, for forms whose approved layout puts it there. */
  errorInFooter?: boolean;
  /** Optional secondary route, such as switching to the full manual editor. */
  secondaryAction?: { label: string; icon?: ReactNode; onClick: () => void };
  submitDisabled?: boolean;
  /** Scrolls the fields while keeping the footer outside the scrolling region. */
  scrollBody?: boolean;
  className?: string;
  children: ReactNode;
}

/** The modal shared by the card operations: header, form, error line, Cancel and the submit button. */
export function DialogFrame({
  title,
  submitLabel,
  taskId,
  onClose,
  onSavingChange,
  validate,
  save,
  dirty = false,
  footerNote,
  errorInFooter = false,
  secondaryAction,
  submitDisabled = false,
  scrollBody = false,
  className = '',
  children,
}: DialogFrameProps) {
  const { t } = useTranslation();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // Set synchronously so a second submit or close in the same tick is refused.
  const savingRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  // Where the focus was when the dialog opened (the button that opened it).
  const [opener] = useState(() => document.activeElement);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [discardAction, setDiscardAction] = useState<'close' | 'secondary'>('close');

  const requestDiscard = (action: 'close' | 'secondary') => {
    if (savingRef.current) return;
    if (dirty) {
      setDiscardAction(action);
      setConfirmDiscard(true);
    } else if (action === 'close') onClose();
    else secondaryAction?.onClick();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    setError('');
    const invalid = validate();
    if (invalid !== null) {
      setError(invalid);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    onSavingChange?.(true);
    try {
      await save();
      savingRef.current = false;
      onClose();
    } catch (cause) {
      savingRef.current = false;
      onSavingChange?.(false);
      setError(cause instanceof Error ? cause.message : t('dialog.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && requestDiscard('close')}>
      <DialogContent
        className={`modal action-dialog ${className}${errorInFooter && error ? ' has-footer-error' : ''}`.trim()}
        showCloseButton={false}
        aria-describedby={undefined}
        onEscapeKeyDown={(event) => {
          if (savingRef.current) event.preventDefault();
        }}
        onPointerDownOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          formRef.current?.querySelector<HTMLElement>('input, textarea')?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (opener instanceof HTMLElement && opener !== document.body && opener.isConnected) {
            opener.focus();
          } else if (taskId !== undefined) {
            findTaskButton(taskId)?.focus();
          }
        }}
      >
        <div className="modal__header">
          <DialogTitle className="modal__title">{title}</DialogTitle>
          <button
            type="button"
            className="modal__close"
            aria-label={t('dialog.close')}
            disabled={saving}
            onClick={() => requestDiscard('close')}
          >
            <XIcon aria-hidden="true" />
          </button>
        </div>
        <form className="modal__form" ref={formRef} onSubmit={submit} noValidate>
          {scrollBody ? <div className="modal__body">{children}</div> : children}
          {error && !errorInFooter && (
            <p className="modal__error" role="alert">
              {error}
            </p>
          )}
          <div className={footerNote || secondaryAction ? 'modal__footer' : undefined}>
            {(footerNote || secondaryAction) && (
              <div className="modal__footer-copy">
                {error && errorInFooter && (
                  <p className="modal__error" role="alert">
                    {error}
                  </p>
                )}
                {footerNote}
                {secondaryAction && (
                  <Button
                    type="button"
                    variant="outline"
                    className="modal__secondary-action"
                    disabled={saving}
                    onClick={() => requestDiscard('secondary')}
                  >
                    {secondaryAction.icon}
                    {secondaryAction.label}
                  </Button>
                )}
              </div>
            )}
            <DialogActions className="modal__actions">
              <Button
                type="button"
                variant="outline"
                onClick={() => requestDiscard('close')}
                disabled={saving}
              >
                {t('dialog.cancel')}
              </Button>
              <Button type="submit" disabled={saving || submitDisabled}>
                {saving ? t('dialog.saving') : submitLabel}
              </Button>
            </DialogActions>
          </div>
        </form>
        <DiscardConfirm
          open={confirmDiscard}
          onOpenChange={setConfirmDiscard}
          onKeep={() => setConfirmDiscard(false)}
          onDiscard={() => {
            setConfirmDiscard(false);
            if (discardAction === 'close') onClose();
            else secondaryAction?.onClick();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
