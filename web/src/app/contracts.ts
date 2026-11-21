import type { BacklogTarget } from '../features/backlog/send';
import type { Dispatch, Ref, RefCallback } from 'react';
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
import type { ArchivePages } from '../features/tasks/model/useArchivePages';
import type { SessionAction, SessionState } from './model/projectSession';
import type { OperationControls } from '../shared/lib/operations/operations';
import type { ViewMode } from '../shared/ui/app-header/Header';
import type { StatusBarProps } from '../shared/ui/status-bar/StatusBar';
import type { BoardMessageKind } from '../pages/board/ui/BoardMessage';
import type { UseProjectsResult } from '../features/projects/model/useProjects';
import type { MessagesController } from './model/useMessagesController';
import type { ActionDialogData } from '../features/tasks/model/actionData';
import type { ResultLinkTarget } from '../features/tasks/results/resultLink';
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
  archive: ArchivePages;
  /** The list of messages and where it is open. */
  messages: MessagesController;
  tasks: TaskSummary[];
  /** Shows a card in another lane at once, before a write has been answered; `unmoveCard` takes it back. */
  moveCard: (id: number, to: TaskSummary['taskStatus']) => void;
  /** The write was accepted: the first newer read of the board wins over the moved card. */
  settleCard: (id: number) => void;
  unmoveCard: (id: number) => void;
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
  bodyRef: Ref<HTMLDivElement>;
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
  /** Whether the Summary lists the card; `null` when the Summary cannot say (not read, or the read failed). */
  isTaskListed: (projectId: ProjectId, id: number) => boolean | null;
  /** The epic with its document read fresh, for an editor; `null` when it cannot be read. */
  loadEpic: (projectId: ProjectId, epic: Epic) => Promise<Epic | null>;
  setRequested: (
    projectId: string | null,
    options?: { history?: 'push' | 'replace' },
  ) => Promise<unknown>;
  /** The result a link points at (`?task=…&result=…`), while the link is in the address. */
  resultLink?: ResultLinkTarget | null;
  /** Takes the link out of the address, when its target has been shown and closed. */
  clearResultLink?: () => void;
  /** The address asks for the messages on the Summary tab (`?messages=summary`). */
  summaryLink?: boolean;
  /** Takes that request out of the address, when the list was shown and closed. */
  clearSummaryLink?: () => void;
  restoreFailure: { projectId: ProjectId; taskId: number } | null;
  setRestoreFailure: (value: { projectId: ProjectId; taskId: number } | null) => void;
  projectName: (projectId: ProjectId) => string | undefined;
  viewMode: ViewMode;
  /** The project whose docs dialog is open, or null. */
  docsProjectId: ProjectId | null;
  setDocsProjectId: (projectId: ProjectId | null) => void;
  /**
   * Calls `listener` when files in a project's Docs may have changed: with the project, or with
   * `null` when it may be any project (the stream reopened). Returns the function that stops it.
   */
  subscribeDocs: (listener: (projectId: string | null) => void) => () => void;
  /** Calls `listener` when the active project's card or epic may have changed; the preview then reads it again. */
  subscribeChanges: (listener: () => void) => () => void;
}

export interface AppWorkspaceActions {
  onSelectProject: (projectId: ProjectId) => void;
  onBack: () => void;
  onAdd: () => void;
  onArchive: () => void;
  onEpics: () => void;
  onDocs: () => void;
  onSelectEpic: (id: string | null) => void;
  onSelectArchiveCard: (id: number | null) => void;
  onSelectCard: (id: number | null) => void;
  onOpenEpic: (epicId: string) => void;
  onMove: (task: TaskSummary, column: ColumnName) => void;
  onReorder: (task: TaskSummary, beforeId: number | null) => void;
  /** Sends Backlog cards to Todo, or moves them to Doing or Done. Returns whether it started without a confirmation. */
  onSend: (ids: number[], to?: BacklogTarget) => boolean;
  /** Moves one Backlog card to Todo (or Doing, Done) as a normal lane move: at once, with no notice but a refusal. */
  onMoveBacklog: (id: number, to?: BacklogTarget) => void;
  sendBusy: boolean;
  /** Sends the Backlog cards of an epic to Todo, in one save. */
  onSendEpic: (epicId: string) => boolean;
  onArchiveDone: () => void;
  onCloseEpic: () => void;
  onEditEpic: () => void;
  onDeleteEpic: () => Promise<void>;
  onFinalizeEpic: () => Promise<void>;
  onRetryEpics: () => void;
  onPreviewTask: () => void;
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
