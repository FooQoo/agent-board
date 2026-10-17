import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { Task } from '../types';

export interface DeleteConfirmProps {
  task: Task;
  action?: 'archive' | 'delete';
  saving: boolean;
  /** The confirmation was opened by the user, so keyboard focus moves into it. */
  focusOnMount: boolean;
  /** Mock mode only: start in the failed state. */
  initialFailed?: boolean;
  onCancel: () => void;
  /** The parent runs the operation through its project lifecycle controls. */
  onConfirm: () => Promise<boolean>;
}

export function DeleteConfirm({
  task,
  action = 'delete',
  saving,
  focusOnMount,
  initialFailed = false,
  onCancel,
  onConfirm,
}: DeleteConfirmProps) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(initialFailed);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const messageId = useId();
  const inFlight = useRef(false);

  useEffect(() => {
    if (focusOnMount) cancelRef.current?.focus();
  }, [focusOnMount]);

  const confirm = async () => {
    if (inFlight.current || saving) return;
    inFlight.current = true;
    setBusy(true);
    setFailed(false);
    try {
      if (!(await onConfirm())) setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="delete-confirm" role="group" aria-labelledby={messageId}>
      <p id={messageId} className="delete-confirm__message">
        {t(action === 'archive' ? 'archive.confirm' : 'delete.confirm', {
          id: task.id,
          title: task.title,
        })}
      </p>
      {failed && (
        <p className="delete-confirm__error" role="alert">
          {t(action === 'archive' ? 'archive.error' : 'delete.error')}
        </p>
      )}
      <div className="delete-confirm__buttons">
        <Button
          type="button"
          variant="destructive"
          className="detail-btn"
          disabled={busy || saving}
          onClick={() => void confirm()}
        >
          {t(action === 'archive' ? 'archive.submit' : 'delete.submit')}
        </Button>
        <Button
          ref={cancelRef}
          type="button"
          variant="outline"
          className="detail-btn detail-btn--plain"
          disabled={busy || saving}
          onClick={onCancel}
        >
          {t('delete.cancel')}
        </Button>
      </div>
    </div>
  );
}
