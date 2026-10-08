import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { archiveCard, deleteCard } from '../api';
import type { Card, ProjectId } from '../types';

export interface DeleteConfirmProps {
  /** The project the confirmation was opened in. The delete goes there, whatever is shown later. */
  projectId: ProjectId;
  card: Card;
  action?: 'archive' | 'delete';
  /** The confirmation was opened by the user, so keyboard focus moves into it. */
  focusOnMount: boolean;
  /** Mock mode only: start in the failed state. */
  initialFailed?: boolean;
  onCancel: () => void;
  /** Reports that the delete started (`true`) or failed and the confirmation stays (`false`). */
  onSavingChange?: (saving: boolean) => void;
  /** Called when the card is gone, whether this request deleted it (204) or it was already gone (404). */
  onDeleted: () => void;
}

export function DeleteConfirm({
  projectId,
  card,
  action = 'delete',
  focusOnMount,
  initialFailed = false,
  onCancel,
  onSavingChange,
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
    onSavingChange?.(true);
    if (action === 'archive') {
      try {
        await archiveCard(projectId, card.id);
        setBusy(false);
        onDeleted();
      } catch {
        setBusy(false);
        onSavingChange?.(false);
        setFailed(true);
      }
      return;
    }
    const result = await deleteCard(projectId, card.id);
    setBusy(false);
    if (result === 'failed') {
      onSavingChange?.(false);
      setFailed(true);
    } else {
      onDeleted();
    }
  };

  return (
    <div className="delete-confirm" role="group" aria-labelledby={messageId}>
      <p id={messageId} className="delete-confirm__message">
        {t(action === 'archive' ? 'archive.confirm' : 'delete.confirm', {
          id: card.id,
          title: card.title,
        })}
      </p>
      {failed && (
        <p className="delete-confirm__error" role="alert">
          {t('delete.error')}
        </p>
      )}
      <div className="delete-confirm__buttons">
        <Button
          type="button"
          variant="destructive"
          className="detail-btn"
          disabled={busy}
          onClick={confirm}
        >
          {t(action === 'archive' ? 'archive.submit' : 'delete.submit')}
        </Button>
        <Button
          ref={cancelRef}
          type="button"
          variant="outline"
          className="detail-btn detail-btn--plain"
          onClick={onCancel}
        >
          {t('delete.cancel')}
        </Button>
      </div>
    </div>
  );
}
