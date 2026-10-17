import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

export interface EpicDeleteConfirmProps {
  open: boolean;
  /** The epic being deleted, named in the question. */
  epicId: string;
  /** The dialog has changes that are not saved yet; deleting throws them away too. */
  dirty: boolean;
  busy: boolean;
  /** The reason the last attempt failed, if it did. */
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/** The question asked before an epic is deleted. The epic dialog uses it for its delete action. */
export function EpicDeleteConfirm({
  open,
  epicId,
  dirty,
  busy,
  error,
  onCancel,
  onConfirm,
}: EpicDeleteConfirmProps) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <DialogContent
        className="editor-confirm"
        showCloseButton={false}
        aria-describedby="epic-delete-body"
      >
        <DialogTitle className="editor-confirm__title">{t('epic.deleteTitle')}</DialogTitle>
        <p className="editor-confirm__body" id="epic-delete-body">
          {t('epic.deleteBody', { id: epicId })}
          {dirty ? ` ${t('epic.deleteDirty')}` : ''}
        </p>
        {error && (
          <p className="editor-confirm__error" role="alert">
            {error}
          </p>
        )}
        <div className="editor-confirm__actions">
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
            {t('epic.deleteCancel')}
          </Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={onConfirm}>
            {t('epic.deleteConfirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
