import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from '@/shared/ui/button';
import { DialogActions } from '@/shared/ui/dialog-actions';
import { cn } from '@/shared/lib/classnames/utils';
import '../styles/confirm-panel.css';

/**
 * The question a panel asks before a destructive step (archive, delete). It sits inside the panel
 * it belongs to, not in a modal: a message, an optional failure, and the confirm and cancel buttons.
 */
export function ConfirmPanel({
  message,
  title,
  error,
  confirmLabel,
  cancelLabel,
  busy,
  focusOnMount = false,
  className,
  messageClassName,
  onConfirm,
  onCancel,
}: {
  message: ReactNode;
  title?: ReactNode;
  /** The reason the last attempt failed, if it did. */
  error?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  busy: boolean;
  /** Keyboard focus goes to Cancel, the safe choice, when the panel opens. */
  focusOnMount?: boolean;
  className?: string;
  messageClassName?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusOnMount) cancelRef.current?.focus();
  }, [focusOnMount]);
  return (
    <div className={cn('confirm-panel', className)} role="group" aria-labelledby={messageId}>
      <p id={messageId} className={cn('confirm-panel__message', messageClassName)}>
        {title && <strong className="confirm-panel__title">{title}</strong>}
        {message}
      </p>
      {error && (
        <p className="confirm-panel__error" role="alert">
          {error}
        </p>
      )}
      <DialogActions size="s" align="start">
        <Button type="button" variant="destructive" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button ref={cancelRef} type="button" variant="outline" disabled={busy} onClick={onCancel}>
          {cancelLabel}
        </Button>
      </DialogActions>
    </div>
  );
}
