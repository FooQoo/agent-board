import { useState } from 'react';
import type { Assignee, Epic, Task, DialogAction } from '../types';
import { CreateDialog } from './CreateDialog';
import { RequestDialog } from './RequestDialog';
import { EditDialog } from './editor/EditDialog';
import { EpicDialog, type EpicApi } from './editor/EpicDialog';
import { MoveDialog } from './MoveDialog';

export type { DialogAction };

export interface ActionDialogData {
  requestId?: string;
  title?: string;
  /** The whole TASK.md or PLAN.md text, frontmatter included (a file that cannot be read is edited this way). */
  description?: string;
  /** The body without its frontmatter, saved with `acceptance`. */
  body?: string;
  acceptance?: import('../types').AcceptanceItem[];
  assignee?: Assignee;
  reason?: string;
  /** Create: the card is made a draft once it is added. */
  isDraft?: boolean;
  /** Edit only: hand the card back to the agents in the same step. */
  finalize?: boolean;
  attachments?: import('./editor/attachmentTypes').EditorAttachment[];
  removedAttachmentIds?: string[];
  requestKind?: 'simple';
  epicId?: string | null;
}

/** Opens the dialog for a card or epic operation. Each operation has its own component. */
export function ActionDialog({
  action,
  onClose,
  onSavingChange,
  onSubmit,
  projectId,
  tasks = [],
  epics = [],
  epicsFetchFailed = false,
  epicApi,
  onOpenTask,
}: {
  action: DialogAction;
  /** The dialog is done: saved, or cancelled. */
  onClose: () => void;
  /** Reports that a save started (`true`) or failed and the input was kept (`false`). */
  onSavingChange?: (saving: boolean) => void;
  onSubmit: (data: ActionDialogData) => Promise<void>;
  projectId?: string;
  /** Latest tasks of the project, for lane confirmation and the epic task list. */
  tasks?: readonly Task[];
  /** The latest epics in the project snapshot, for request creation. */
  epics?: readonly Epic[];
  /** The epic snapshot failed to refresh; do not present the missing list as empty. */
  epicsFetchFailed?: boolean;
  /** The writes of the epic dialog, bound to the project it was opened in. */
  epicApi?: EpicApi;
  /** The epic dialog asks for the board to show a task. */
  onOpenTask?: (taskId: number) => void;
}) {
  const [manualCreate, setManualCreate] = useState(false);
  switch (action.kind) {
    case 'create':
      return (
        <CreateDialog
          projectId={projectId}
          onClose={onClose}
          onSavingChange={onSavingChange}
          onSubmit={onSubmit}
        />
      );
    case 'request':
      if (manualCreate)
        return (
          <CreateDialog
            projectId={projectId}
            onClose={onClose}
            onSavingChange={onSavingChange}
            onSubmit={onSubmit}
          />
        );
      return (
        <RequestDialog
          epics={epics}
          epicsFetchFailed={epicsFetchFailed}
          onClose={onClose}
          onSavingChange={onSavingChange}
          onSubmit={(input) => onSubmit(input)}
          onCreateManually={() => setManualCreate(true)}
        />
      );
    case 'move':
      return (
        <MoveDialog
          task={tasks.find((task) => task.id === action.task.id) ?? action.task}
          target={action.target}
          onClose={onClose}
          onSavingChange={onSavingChange}
          onSubmit={onSubmit}
        />
      );
    case 'edit':
      return (
        <EditDialog
          task={action.task}
          onClose={onClose}
          onSavingChange={onSavingChange}
          onSubmit={onSubmit}
          projectId={projectId}
        />
      );
    case 'epic':
      if (epicApi === undefined || onOpenTask === undefined) return null;
      return (
        <EpicDialog
          epic={action.epic}
          tasks={tasks}
          api={epicApi}
          projectId={projectId}
          onOpenTask={onOpenTask}
          onClose={onClose}
          onSavingChange={onSavingChange}
        />
      );
  }
}
