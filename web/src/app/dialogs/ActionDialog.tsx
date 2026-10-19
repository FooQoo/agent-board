import { useState } from 'react';
import type { Epic, Task, DialogAction } from '../../shared/api/contracts';
import type { ActionDialogData } from '../../features/tasks/model/actionData';
import { CreateDialog } from '../../features/tasks/create/CreateDialog';
import { RequestDialog } from '../../features/tasks/request/RequestDialog';
import { EditDialog } from '../../features/tasks/editor/EditDialog';
import { EpicDialog, type EpicApi } from '../../features/epics/editor/EpicDialog';
import { MoveDialog } from '../../features/tasks/move/MoveDialog';
import { TaskProgressRow } from '../../features/tasks/card/TaskProgressRow';
import { EpicBadge } from '../../features/epics/label/EpicBadge';
import { epicInk } from '../../features/epics/model/epic';
import type { ProgressTaskRenderer } from '../../features/epics/editor/EpicProgressList';
import type { EpicRef } from '../../shared/api/contracts';
import '../../features/epics/editor/editor-epic.css';

export type { DialogAction };

/** The epic chip beside the card editor, in the epic's color. */
const renderEpicChip = (epic: EpicRef) => (
  <span
    className="editor__epic-chip"
    style={{ background: epic.color, color: epicInk(epic.color) }}
    title={epic.name}
  >
    {epic.id}
  </span>
);

/** A task row of the epic's progress table: the card's parts, with the drag grip first. */
const renderEpicTask: ProgressTaskRenderer = (task, row) => (
  <TaskProgressRow task={task} {...row} />
);

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
          renderEpic={(epic, className) => <EpicBadge epic={epic} className={className} />}
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
          renderEpicChip={renderEpicChip}
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
          renderTask={renderEpicTask}
        />
      );
  }
}
