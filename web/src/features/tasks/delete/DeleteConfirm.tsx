import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmPanel } from '@/shared/ui/confirm-panel';
import type { TaskSummary } from '../../../shared/api/contracts';

export interface DeleteConfirmProps {
  task: Pick<TaskSummary, 'id' | 'title'>;
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
  const inFlight = useRef(false);

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
    <ConfirmPanel
      className="delete-confirm"
      messageClassName="delete-confirm__message"
      message={t(action === 'archive' ? 'archive.confirm' : 'delete.confirm', {
        id: task.id,
        title: task.title,
      })}
      error={failed ? t(action === 'archive' ? 'archive.error' : 'delete.error') : null}
      confirmLabel={t(action === 'archive' ? 'archive.submit' : 'delete.submit')}
      cancelLabel={t('delete.cancel')}
      busy={busy || saving}
      focusOnMount={focusOnMount}
      onConfirm={() => void confirm()}
      onCancel={onCancel}
    />
  );
}
