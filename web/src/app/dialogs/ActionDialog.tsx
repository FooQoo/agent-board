import type { Epic, ProjectId, Task, TaskSummary, DialogAction } from '../../shared/api/contracts';
import type { ChangeSubscription } from '../../shared/ui/editor/useFollowLatest';
import type { ActionDialogData } from '../../features/tasks/model/actionData';
import { AskAiDialog } from '../../features/messages/ask/AskAiDialog';
import { EditDialog } from '../../features/tasks/editor/EditDialog';
import { TaskPreviewDialog } from './TaskPreviewDialog';
import { EpicDialog, type EpicApi } from '../../features/epics/editor/EpicDialog';
import { TaskProgressRow } from '../../features/tasks/card/TaskProgressRow';
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
  epicApi,
  onOpenTask,
  subscribeChanges,
  loadTask,
  loadEpic,
  isTaskListed,
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
  /** The writes of the epic dialog, bound to the project it was opened in. */
  epicApi?: EpicApi;
  /** The epic dialog asks for the board to show a task. */
  onOpenTask?: (taskId: number) => void;
  /** The previews call the listener when the active project may have changed. */
  subscribeChanges?: ChangeSubscription;
  /** The task preview reads its card again through this. */
  loadTask?: (projectId: ProjectId, card: Task) => Promise<Task | null>;
  /** Whether the board still lists the card; a card that left the board while open was archived. */
  isTaskListed?: (projectId: ProjectId, id: number) => boolean | null;
  /** The epic preview reads its epic again through this. */
  loadEpic?: (projectId: ProjectId, epic: Epic) => Promise<Epic | null>;
  /** The task preview entered or left a draft. */
  onChanged?: () => void;
}) {
  switch (action.kind) {
    case 'request':
      return (
        <AskAiDialog
          onClose={onClose}
          onSavingChange={onSavingChange}
          onSubmit={(input) =>
            onSubmit({ requestText: input.text, attachments: input.attachments })
          }
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
          isTaskListed={isTaskListed}
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
