import type { Task, Epic, Project, ProjectId } from '../../shared/api/contracts';
import type {
  AnswerFormKey,
  AnswerFormStateStore,
  AnswerResult,
  AnswerWriter,
} from '../../features/tasks/answer/model/answer';
import type { OperationControls } from '../../shared/lib/operations/operations';

export interface MonitorTask {
  projectId: ProjectId;
  projectName: string;
  task: Task;
}

export type MonitorScope = 'all' | ProjectId;
export type MonitorSummary = { todo: number; doing: number; done: number } | null;
export type MonitorDetailTab = 'description' | 'acceptance' | 'history' | 'epic';
export type MonitorFreshnessState = 'loading' | 'syncing' | 'fresh' | 'stale' | 'partial' | 'error';

export interface MonitorFreshness {
  state: MonitorFreshnessState;
  lastFetchedAt: string | null;
  failedProjectIds: ProjectId[];
  snapshotProblems: Array<{ projectId: ProjectId; file: string; field: string; reason: string }>;
}

export interface MonitorReadResolvers {
  attachmentUrl(projectId: ProjectId, taskId: number, attachmentId: string): string;
  epicAttachmentUrl(projectId: ProjectId, epicId: string, attachmentId: string): string;
  getEpics(projectId: ProjectId, signal?: AbortSignal): Promise<Epic[]>;
}

/** Explicitly unconnected U1 resolvers. U4 supplies the live read-only API adapter. */
export const unconnectedMonitorReadResolvers: MonitorReadResolvers = {
  attachmentUrl: (projectId, taskId, attachmentId) =>
    `/monitor/api/projects/${encodeURIComponent(projectId)}/tasks/${taskId}/attachments/${encodeURIComponent(attachmentId)}`,
  epicAttachmentUrl: (projectId, epicId, attachmentId) =>
    `/monitor/api/projects/${encodeURIComponent(projectId)}/epics/${encodeURIComponent(epicId)}/attachments/${encodeURIComponent(attachmentId)}`,
  getEpics: async () => {
    throw new Error('Monitor epic resolver is not connected.');
  },
};

export const MONITOR_API_BASE = '/monitor/api/';

export interface MonitorViewProps {
  projects: Project[];
  scope: MonitorScope;
  summary: MonitorSummary;
  todo: MonitorTask[];
  doing: MonitorTask[];
  done: MonitorTask[];
  freshness: MonitorFreshness;
  onScopeChange(scope: MonitorScope): void;
  onRefresh(): void;
  answerController?: MonitorAnswerController;
  readResolvers?: MonitorReadResolvers;
  scopeLocked?: boolean;
  /** Read-only resolvers used by the monitor drawer. */
  onOpenDetail?(target: MonitorTask, tab: MonitorDetailTab): void;
  routeNotice?: boolean;
  /** Told whenever the detail drawer opens or closes; the page does not reload while it is open. */
  onDetailOpenChange?(open: boolean): void;
}

export interface OrphanAnswerDraft {
  key: AnswerFormKey;
  projectName: string;
  taskId: number;
  text: string;
  choiceId: string | null;
}

export interface MonitorAnswerController {
  writeAnswer: AnswerWriter;
  stateStore: AnswerFormStateStore;
  operationsFor(projectId: ProjectId, taskId: number, requestId: string | null): OperationControls;
  onAnswered(item: MonitorTask, requestId: string, result: AnswerResult): void;
  markRequestStale(projectId: ProjectId, taskId: number, requestId: string): void;
  orphanDrafts(tasks: readonly MonitorTask[]): OrphanAnswerDraft[];
  clearOrphanDraft(key: AnswerFormKey): void;
  reconcileTasks(tasks: readonly MonitorTask[]): void;
  tasksWithSavedAnswers(tasks: readonly MonitorTask[], snapshotIsFresh: boolean): MonitorTask[];
  wasAnswered(projectId: ProjectId, taskId: number, requestId: string | null): boolean;
  locked: boolean;
}
