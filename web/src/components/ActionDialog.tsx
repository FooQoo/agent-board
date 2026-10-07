import type { Assignee, DialogAction } from '../types';
import { CreateDialog } from './CreateDialog';
import { EditDialog } from './EditDialog';
import { MoveDialog } from './MoveDialog';

export type { DialogAction };

export interface ActionDialogData {
  title?: string;
  description?: string;
  assignee?: Assignee;
  reason?: string;
}

/** Opens the dialog for a card operation. Each operation has its own component. */
export function ActionDialog({
  action,
  onClose,
  onSavingChange,
  onSubmit,
}: {
  action: DialogAction;
  /** The dialog is done: saved, or cancelled. */
  onClose: () => void;
  /** Reports that a save started (`true`) or failed and the input was kept (`false`). */
  onSavingChange?: (saving: boolean) => void;
  onSubmit: (data: ActionDialogData) => Promise<void>;
}) {
  switch (action.kind) {
    case 'create':
      return <CreateDialog onClose={onClose} onSavingChange={onSavingChange} onSubmit={onSubmit} />;
    case 'move':
      return (
        <MoveDialog
          card={action.card}
          target={action.target}
          onClose={onClose}
          onSavingChange={onSavingChange}
          onSubmit={onSubmit}
        />
      );
    case 'edit':
      return <EditDialog card={action.card} onClose={onClose} />;
  }
}
