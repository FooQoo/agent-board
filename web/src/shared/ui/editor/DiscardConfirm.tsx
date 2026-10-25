import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { DialogActions } from '@/shared/ui/dialog-actions';
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/dialog';

export interface DiscardConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Keeps the edit: the question closes and the dialog stays as it was. */
  onKeep: () => void;
  /** Throws the edit away and carries on (closing, or moving to another card). */
  onDiscard: () => void;
  keepLabel?: string;
  discardLabel?: string;
}

/** The question asked before an unsaved edit is thrown away. Shared by the editors. */
export function DiscardConfirm({
  open,
  onOpenChange,
  onKeep,
  onDiscard,
  keepLabel,
  discardLabel,
}: DiscardConfirmProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="editor-confirm"
        showCloseButton={false}
        aria-describedby="editor-confirm-body"
      >
        <DialogTitle className="editor-confirm__title">{t('editor.discardTitle')}</DialogTitle>
        <p className="editor-confirm__body" id="editor-confirm-body">
          {t('editor.discardBody')}
        </p>
        <DialogActions>
          <Button type="button" variant="outline" onClick={onKeep}>
            {keepLabel ?? t('editor.keepEditing')}
          </Button>
          <Button type="button" variant="destructive" onClick={onDiscard}>
            {discardLabel ?? t('editor.discard')}
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
