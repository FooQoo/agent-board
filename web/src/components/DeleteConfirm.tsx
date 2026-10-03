import { useEffect, useId, useRef, useState } from 'react';
import { deleteCard } from '../api';
import type { Card } from '../types';

export interface DeleteConfirmProps {
  card: Card;
  /** The confirmation was opened by the user, so keyboard focus moves into it. */
  focusOnMount: boolean;
  /** Mock mode only: start in the failed state. */
  initialFailed?: boolean;
  onCancel: () => void;
  /** Called when the card is gone, whether this request deleted it (204) or it was already gone (404). */
  onDeleted: () => void;
}

export function DeleteConfirm({ card, focusOnMount, initialFailed = false, onCancel, onDeleted }: DeleteConfirmProps) {
  const [failed, setFailed] = useState(initialFailed);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const messageId = useId();

  useEffect(() => {
    if (focusOnMount) cancelRef.current?.focus();
  }, [focusOnMount]);

  const confirm = async () => {
    setBusy(true);
    setFailed(false);
    const result = await deleteCard(card.id);
    setBusy(false);
    if (result === 'failed') {
      setFailed(true);
    } else {
      onDeleted();
    }
  };

  return (
    <div className="delete-confirm" role="group" aria-labelledby={messageId}>
      <p id={messageId} className="delete-confirm__message">
        Delete #{card.id} "{card.title}"? This cannot be undone.
      </p>
      {failed && (
        <p className="delete-confirm__error" role="alert">
          Could not delete the card. Try again.
        </p>
      )}
      <div className="delete-confirm__buttons">
        <button type="button" className="button button--danger" disabled={busy} onClick={confirm}>
          Delete
        </button>
        <button ref={cancelRef} type="button" className="button button--outline" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
