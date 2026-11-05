import { useCallback, useState, type ReactNode } from 'react';
import { EditDialog } from '../../features/tasks/editor/EditDialog';
import { setDraft } from '../../features/tasks/api/edit';
import type { ChangeSubscription } from '../../shared/ui/editor/useFollowLatest';
import type { ActionDialogData } from '../../features/tasks/model/actionData';
import type { EpicRef, ProjectId, Task } from '../../shared/api/contracts';

export interface TaskPreviewDialogProps {
  task: Task;
  /** The card lives in the archive: the preview only reads. */
  archived?: boolean;
  projectId: ProjectId;
  renderEpicChip: (epic: EpicRef) => ReactNode;
  subscribeChanges?: ChangeSubscription;
  /** Reads the card and its text again, with its state as the Summary has it now. */
  loadTask: (projectId: ProjectId, card: Task) => Promise<Task | null>;
  /** Whether the board still lists the card; `null` when that is not known. */
  isTaskListed?: (projectId: ProjectId, id: number) => boolean | null;
  /** A draft was entered or left: the board should show it. */
  onChanged: () => void;
  onClose: () => void;
  onSavingChange?: (saving: boolean) => void;
  onSubmit: (data: ActionDialogData) => Promise<void>;
}

/**
 * The preview of a card, wired to the server: entering and leaving the draft, reading the card
 * again, and the card's state. The card running (or archived) makes the preview read-only; the
 * state is taken from every read, so a card that starts running while the preview is open turns it
 * read-only, and one that stops running turns it back.
 */
export function TaskPreviewDialog({
  task,
  archived = false,
  projectId,
  loadTask,
  isTaskListed,
  onChanged,
  ...rest
}: TaskPreviewDialogProps) {
  const [running, setRunning] = useState(task.agentStatus === 'running');
  // A card that was on the board when the preview opened and is not any more was archived.
  const [archivedWhileOpen, setArchivedWhileOpen] = useState(false);
  const reload = useCallback(async () => {
    const next = await loadTask(projectId, task);
    if (next) {
      setRunning(next.agentStatus === 'running');
      if (!archived && isTaskListed?.(projectId, task.id) === false) setArchivedWhileOpen(true);
    }
    return next;
  }, [archived, isTaskListed, loadTask, projectId, task]);
  const enterDraft = useCallback(async () => {
    const { task: entered } = await setDraft(projectId, task.id, true);
    onChanged();
    return entered;
  }, [onChanged, projectId, task.id]);
  const leaveDraft = useCallback(async () => {
    await setDraft(projectId, task.id, false, { discard: true });
    onChanged();
  }, [onChanged, projectId, task.id]);
  return (
    <EditDialog
      task={task}
      projectId={projectId}
      readOnlyReason={archived || archivedWhileOpen ? 'archived' : running ? 'running' : undefined}
      enterDraft={enterDraft}
      leaveDraft={leaveDraft}
      reload={reload}
      {...rest}
    />
  );
}
