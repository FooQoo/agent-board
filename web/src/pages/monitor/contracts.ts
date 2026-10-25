import type { Task, ProjectId } from '../../shared/api/contracts';
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

export type MonitorSummary = { todo: number; doing: number; done: number } | null;
export type MonitorDetailTab = 'description' | 'acceptance' | 'history' | 'epic';
export type MonitorFreshnessState = 'loading' | 'syncing' | 'fresh' | 'stale' | 'partial' | 'error';

export interface MonitorFreshness {
  state: MonitorFreshnessState;
  lastFetchedAt: string | null;
  snapshotProblems: Array<{ projectId: ProjectId; file: string; field: string; reason: string }>;
}

/** Where a task's or an epic's attachments are read from. */
export interface MonitorReadResolvers {
  attachmentUrl(projectId: ProjectId, taskId: number, attachmentId: string): string;
  epicAttachmentUrl(projectId: ProjectId, epicId: string, attachmentId: string): string;
}

/** Resolvers for pages that are not connected to a server (stories, the sample-data mode). */
export const unconnectedMonitorReadResolvers: MonitorReadResolvers = {
  attachmentUrl: (projectId, taskId, attachmentId) =>
    `/monitor/api/projects/${encodeURIComponent(projectId)}/tasks/${taskId}/attachments/${encodeURIComponent(attachmentId)}`,
  epicAttachmentUrl: (projectId, epicId, attachmentId) =>
    `/monitor/api/projects/${encodeURIComponent(projectId)}/epics/${encodeURIComponent(epicId)}/attachments/${encodeURIComponent(attachmentId)}`,
};

export const MONITOR_API_BASE = '/monitor/api/';

export interface MonitorViewProps {
  summary: MonitorSummary;
  todo: MonitorTask[];
  doing: MonitorTask[];
  done: MonitorTask[];
  freshness: MonitorFreshness;
  /** A person asked for fresh data: the screen asks the server now, without the presentation hold. */
  onRefresh(): void;
  /** True while that request runs; the button waits. */
  refreshing?: boolean;
  answerController?: MonitorAnswerController;
  /** Read-only resolvers used by the monitor drawer. */
  readResolvers?: MonitorReadResolvers;
  onOpenDetail?(target: MonitorTask, tab: MonitorDetailTab): void;
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
