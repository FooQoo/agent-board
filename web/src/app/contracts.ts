import type { Dispatch, RefCallback, RefObject } from 'react';
import type { UseBoardResult } from '../pages/board/model/useBoard';
import type {
  Epic,
  ProjectId,
  Task,
  TaskSummary,
  DialogAction,
  ColumnName,
} from '../shared/api/contracts';
import type { BoardView } from './data/assemble';
import type { useArchive } from '../pages/archive/model/useArchive';
import type { SessionAction, SessionState } from './model/projectSession';
import type { OperationControls } from '../shared/lib/operations/operations';
import type { ViewMode } from '../shared/ui/app-header/Header';
import type { StatusBarProps } from '../shared/ui/status-bar/StatusBar';
import type { BoardMessageKind } from '../pages/board/ui/BoardMessage';
import type { UseProjectsResult } from '../features/projects/model/useProjects';
import type { TaskAnswerController } from '../features/tasks/answer/model/useTaskAnswers';
import type { ActionDialogData } from '../features/tasks/model/actionData';
import type { ArchivedTask } from '../features/tasks/api/read';
import type { EpicApi } from '../features/epics/editor/epicApi';

export type AppInitial = { select?: number; confirm?: boolean; deleteFail?: boolean };

export type AppView =
  | 'projects-loading'
  | 'projects-error'
  | 'no-projects'
  | 'resolving'
  | 'not-found'
  | 'board-loading'
  | 'board-error'
  | 'board';

export interface AppControllerModel {
  session: SessionState;
  dispatch: Dispatch<SessionAction>;
  operations: OperationControls;
  projects: UseProjectsResult;
  board: UseBoardResult;
  archive: ReturnType<typeof useArchive>;
  answerSession: TaskAnswerController;
  tasks: TaskSummary[];
  selected: TaskSummary | null;
  archivedSelected: ArchivedTask | null;
  selectedEpic: Epic | null;
  activeId: ProjectId | null;
  activeName: string | null;
  known: boolean;
  boardData: BoardView | null;
  view: AppView;
  archiveVisible: boolean;
  epicsVisible: boolean;
  detailShown: boolean;
  stalePage: boolean;
  isMockTask: boolean;
  mockInitial: { select?: number; confirm?: boolean; deleteFail?: boolean } | undefined;
  barStatus: StatusBarProps['status'];
  message: Exclude<BoardMessageKind, 'empty'> | null;
  retry: () => void;
  connected: boolean;
  streamDown: boolean;
  width: number;
  bodyRef: RefObject<HTMLDivElement | null>;
  attachLayoutRef: RefCallback<HTMLElement>;
  startDrag: (clientX: number) => void;
  moveDrag: (clientX: number) => void;
  endDrag: () => void;
  archiveLifecycle: ReturnType<
    typeof import('../features/tasks/model/useTaskLifecycle').useTaskLifecycle
  >;
  openDialog: (dialog: DialogAction) => void;
  refreshProject: (projectId: ProjectId) => void;
  /** The task with its Detail read fresh, for an editor; `null` when the Detail cannot be read. */
  loadTask: (projectId: ProjectId, card: TaskSummary) => Promise<Task | null>;
  /** The epic with its document read fresh, for an editor; `null` when it cannot be read. */
  loadEpic: (projectId: ProjectId, epic: Epic) => Promise<Epic | null>;
  setRequested: (
    projectId: string | null,
    options?: { history?: 'push' | 'replace' },
  ) => Promise<unknown>;
  restoreFailure: { projectId: ProjectId; taskId: number } | null;
  setRestoreFailure: (value: { projectId: ProjectId; taskId: number } | null) => void;
  projectName: (projectId: ProjectId) => string | undefined;
  viewMode: ViewMode;
}

export interface AppWorkspaceActions {
  onSelectProject: (projectId: ProjectId) => void;
  onBack: () => void;
  onAdd: () => void;
  onArchive: () => void;
  onEpics: () => void;
  onSelectEpic: (id: string | null) => void;
  onSelectArchiveCard: (id: number | null) => void;
  onSelectCard: (id: number | null) => void;
  onAnswerChanged: () => void;
  onOpenEpic: (epicId: string) => void;
  onMove: (task: TaskSummary, column: ColumnName) => void;
  onReorder: (task: TaskSummary, beforeId: number | null) => void;
  onArchiveDone: () => void;
  onCloseEpic: () => void;
  onEditEpic: () => void;
  onDeleteEpic: () => Promise<void>;
  onRetryEpics: () => void;
  onEditTask: () => void;
  onTaskChanged: () => void;
  onRemove: (action: 'archive' | 'delete', task: TaskSummary) => Promise<boolean>;
  onRestore: () => void;
  onCloseDetails: () => void;
}

export interface AppDialogsProps {
  model: AppControllerModel;
  onSubmit: (data: ActionDialogData) => Promise<void>;
  onCloseOperation: () => void;
  onSavingChange: (saving: boolean) => void;
  onOpenTask: (taskId: number) => void;
  onConfirmBulkArchive: () => Promise<void>;
  onCancelBulkArchive: () => void;
  epicApi?: EpicApi;
}
