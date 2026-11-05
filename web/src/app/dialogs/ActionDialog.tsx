import { useState } from 'react';
import type { Epic, ProjectId, Task, TaskSummary, DialogAction } from '../../shared/api/contracts';
import type { ChangeSubscription } from '../../shared/ui/editor/useFollowLatest';
import type { ActionDialogData } from '../../features/tasks/model/actionData';
import { CreateDialog } from '../../features/tasks/create/CreateDialog';
import { RequestDialog } from '../../features/tasks/request/RequestDialog';
import { EditDialog } from '../../features/tasks/editor/EditDialog';
import { TaskPreviewDialog } from './TaskPreviewDialog';
import { EpicDialog, type EpicApi } from '../../features/epics/editor/EpicDialog';
import { MoveDialog } from '../../features/tasks/move/MoveDialog';
import { TaskProgressRow } from '../../features/tasks/card/TaskProgressRow';
import { EpicBadge } from '../../features/epics/label/EpicBadge';
import { epicInk } from '../../features/epics/model/epic';
import type { ProgressTaskRenderer } from '../../features/epics/editor/EpicProgressList';
import type { EpicRef } from '../../shared/api/contracts';

export type { DialogAction };

const noop = () => {};

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
  subscribeChanges,
  loadTask,
  loadEpic,
  onChanged,
}: {
  action: DialogAction;
  /** The dialog is done: saved, or cancelled. */
  onClose: () => void;
  /** Reports that a save started (`true`) or failed and the input was kept (`false`). */
  onSavingChange?: (saving: boolean) => void;
  onSubmit: (data: ActionDialogData) => Promise<void>;
  projectId?: string;
  /** Latest tasks of the project, for lane confirmation and the epic task list. */
  tasks?: readonly TaskSummary[];
  /** The latest epics in the project snapshot, for request creation. */
  epics?: readonly Epic[];
  /** The epic snapshot failed to refresh; do not present the missing list as empty. */
  epicsFetchFailed?: boolean;
  /** The writes of the epic dialog, bound to the project it was opened in. */
  epicApi?: EpicApi;
  /** The epic dialog asks for the board to show a task. */
  onOpenTask?: (taskId: number) => void;
  /** The previews call the listener when the active project may have changed. */
  subscribeChanges?: ChangeSubscription;
  /** The task preview reads its card again through this. */
  loadTask?: (projectId: ProjectId, card: Task) => Promise<Task | null>;
  /** The epic preview reads its epic again through this. */
  loadEpic?: (projectId: ProjectId, epic: Epic) => Promise<Epic | null>;
  /** The task preview entered or left a draft. */
  onChanged?: () => void;
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
      // Without a way to read the card again the dialog only edits what it was given.
      if (projectId === undefined || loadTask === undefined)
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
      return (
        <TaskPreviewDialog
          task={action.task}
          archived={action.archived}
          onClose={onClose}
          onSavingChange={onSavingChange}
          onSubmit={onSubmit}
          projectId={projectId as ProjectId}
          renderEpicChip={renderEpicChip}
          subscribeChanges={subscribeChanges}
          loadTask={loadTask}
          onChanged={onChanged ?? noop}
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
          subscribe={subscribeChanges}
          load={
            loadEpic && projectId !== undefined
              ? () => loadEpic(projectId as ProjectId, action.epic)
              : undefined
          }
        />
      );
  }
}
