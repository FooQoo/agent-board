import type { Task, Epic } from '../../../shared/api/contracts';
import type { ProgressTaskRenderer } from './EpicProgressList';
import { EpicEditorView } from './EpicEditorView';
import { useEpicEditor } from './useEpicEditor';
import type { EpicApi } from './epicApi';

export type { EpicApi } from './epicApi';

/** The writes an epic dialog makes, one at a time and in this order by the dialog. */
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
