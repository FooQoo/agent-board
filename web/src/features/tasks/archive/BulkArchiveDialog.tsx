import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { DialogActions } from '@/shared/ui/dialog-actions';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog';
import type { TaskSummary } from '../../../shared/api/contracts';
import '../../../shared/styles/modal.css';

export interface BulkArchiveDialogProps {
  projectName: string;
  targets: readonly TaskSummary[];
  saving: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

/** Displays the session's fixed bulk-archive target snapshot and reports the user's choice. */
export function BulkArchiveDialog({
  projectName,
  targets,
  saving,
  onConfirm,
  onCancel,
}: BulkArchiveDialogProps) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const close = () => {
    if (saving || submitting.current) return;
    onCancel();
  };

  const confirm = async () => {
    if (saving || submitting.current || targets.length === 0) return;
    submitting.current = true;
    setError(null);
    try {
      await onConfirm();
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : t('archive.error'));
      submitting.current = false;
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="modal bulk-archive__panel"
        overlayClassName="bulk-archive__overlay"
        showCloseButton={false}
        aria-busy={saving}
        onEscapeKeyDown={(event) => {
          if (saving || submitting.current) event.preventDefault();
        }}
        onPointerDownOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          openerRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          cancelRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const opener = openerRef.current;
          if (opener?.isConnected && !opener.matches(':disabled')) {
            opener.focus();
            return;
          }
          const fallback =
            document.querySelector<HTMLButtonElement>('.lane-header__archive:not(:disabled)') ??
            document.querySelector<HTMLButtonElement>('.header__archive:not(:disabled)');
          fallback?.focus();
        }}
      >
        <div className="modal__header">
          <DialogTitle className="modal__title">{t('archive.bulkTitle')}</DialogTitle>
        </div>
        <DialogDescription className="bulk-archive__description">
          {t('archive.bulkDescription', { projectName, count: targets.length })}
        </DialogDescription>
        <div
          className="bulk-archive__table-wrap"
          role="region"
          aria-label={t('archive.bulkTargets', { count: targets.length })}
          // This scroll region must be keyboard-focusable when its 100-row table overflows.
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a labelled scroll region needs keyboard focus
          tabIndex={0}
          onKeyDown={(event) => {
            const step = event.currentTarget.clientHeight * 0.8;
            const positions: Record<string, number> = {
              ArrowDown: event.currentTarget.scrollTop + 40,
              ArrowUp: event.currentTarget.scrollTop - 40,
              End: event.currentTarget.scrollHeight,
              Home: 0,
              PageDown: event.currentTarget.scrollTop + step,
              PageUp: event.currentTarget.scrollTop - step,
            };
            const next = positions[event.key];
            if (next === undefined) return;
            event.preventDefault();
            event.currentTarget.scrollTo({ top: next });
          }}
        >
          <table className="bulk-archive__table">
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col">{t('archive.cardTitle')}</th>
                <th scope="col">{t('archive.assignee')}</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((task) => (
                <tr key={task.id}>
                  <td>#{task.id}</td>
                  <td>{task.title}</td>
                  <td>{t(`assignee.${task.assignee}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {error && (
          <p className="bulk-archive__error" role="alert">
            {error}
          </p>
        )}
        <p className="bulk-archive__note">{t('archive.bulkRetentionNote')}</p>
        <DialogActions>
          <Button ref={cancelRef} type="button" variant="outline" onClick={close} disabled={saving}>
            {t('delete.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void confirm()}
            disabled={saving || targets.length === 0}
          >
            {saving ? t('dialog.saving') : t('archive.bulkSubmit', { count: targets.length })}
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
