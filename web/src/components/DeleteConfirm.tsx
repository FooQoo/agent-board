import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
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

export function DeleteConfirm({
  card,
  focusOnMount,
  initialFailed = false,
  onCancel,
  onDeleted,
}: DeleteConfirmProps) {
  const { t } = useTranslation();
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
        {t('delete.confirm', { id: card.id, title: card.title })}
      </p>
      {failed && (
        <p className="delete-confirm__error" role="alert">
          {t('delete.error')}
        </p>
      )}
      <div className="delete-confirm__buttons">
        <Button ref={cancelRef} type="button" variant="outline" onClick={onCancel}>
          {t('delete.cancel')}
        </Button>
        <Button type="button" variant="destructive" disabled={busy} onClick={confirm}>
          {t('delete.submit')}
        </Button>
      </div>
    </div>
  );
}
