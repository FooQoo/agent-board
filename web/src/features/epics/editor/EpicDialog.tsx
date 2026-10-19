import type { Task, Epic } from '../../../shared/api/contracts';
import type { EditorAttachment } from '../../../shared/ui/editor/attachmentTypes';
import type { ProgressTaskRenderer } from './EpicProgressList';
import { EpicEditorView } from './EpicEditorView';
import { useEpicEditor } from './useEpicEditor';

/** The writes an epic dialog makes, one at a time and in this order by the dialog. */
export interface EpicApi {
  /** Adds the new images to the epic; `requestId` makes a retry the same write. */
  addImages(files: EditorAttachment[], requestId: string): Promise<void>;
  removeImage(attachmentId: string): Promise<void>;
  /** The whole plan text, or its Markdown body, saved in one request. */
  savePlan(input: { plan: string } | { body: string }): Promise<void>;
  saveDetails(details: { name: string; color: string; isDraft: boolean }): Promise<void>;
  /** Saves the card order of the epic: the IDs of its tasks, first is first. */
  savePriority(priority: number[]): Promise<void>;
  /** Deletes the epic. The server refuses while a task still names it. */
  remove(): Promise<void>;
}

export interface EpicDialogProps {
  epic: Epic;
  /** Draws a task in the progress table. The caller supplies it. */
  renderTask: ProgressTaskRenderer;
  /** Every task of the project, read when the dialog is shown and kept up to date by the board. */
  tasks: readonly Task[];
  api: EpicApi;
  projectId?: string;
  onOpenTask: (taskId: number) => void;
  onClose: () => void;
  onSavingChange?: (saving: boolean) => void;
}

/** Connects the public epic editor contract to its state controller and display. */
export function EpicDialog({
  epic,
  tasks,
  api,
  projectId = '',
  onOpenTask,
  onClose,
  onSavingChange,
  renderTask,
}: EpicDialogProps) {
  const state = useEpicEditor({ epic, tasks, api, projectId, onOpenTask, onClose, onSavingChange });
  return (
    <EpicEditorView
      epic={epic}
      state={state}
      onOpenTask={onOpenTask}
      onClose={onClose}
      renderTask={renderTask}
    />
  );
}
