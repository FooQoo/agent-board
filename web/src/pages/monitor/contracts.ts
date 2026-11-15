import type { Task, ProjectId } from '../../shared/api/contracts';
import type { PreferencesEndpoint } from '../../shared/preferences';
import type { PhoneGuideLink } from '../../features/onboarding/model/phoneGuideLink';
import type { HeaderProps } from '../../shared/ui/app-header/Header';
import type { AnswerBook } from '../../features/tasks/answer/model/answerBook';
import type {
  AnswersWriter,
  BandQuestion,
  QuestionReader,
} from '../../features/tasks/answer/model/qa';

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

/**
 * Where a task's or an epic's attachments are read from, and the one change the drawer makes: checking
 * or unchecking a condition. Without `setAcceptance` (no server connected) the conditions are read-only.
 */
export interface MonitorReadResolvers {
  attachmentUrl(projectId: ProjectId, taskId: number, attachmentId: string): string;
  epicAttachmentUrl(projectId: ProjectId, epicId: string, attachmentId: string): string;
  setAcceptance?(
    projectId: ProjectId,
    taskId: number,
    conditionId: string,
    done: boolean,
  ): Promise<unknown>;
}

/** Resolvers for pages that are not connected to a server (stories, the sample-data mode). */
export const unconnectedMonitorReadResolvers: MonitorReadResolvers = {
  attachmentUrl: (projectId, taskId, attachmentId) =>
    `/monitor/api/projects/${encodeURIComponent(projectId)}/tasks/${taskId}/attachments/${encodeURIComponent(attachmentId)}`,
  epicAttachmentUrl: (projectId, epicId, attachmentId) =>
    `/monitor/api/projects/${encodeURIComponent(projectId)}/epics/${encodeURIComponent(epicId)}/attachments/${encodeURIComponent(attachmentId)}`,
};

export const MONITOR_API_BASE = '/monitor/api/';

/** The project switcher the header shows when the app lets the person change project. */
export type MonitorHeaderProps = Pick<
  HeaderProps,
  'projects' | 'activeProjectId' | 'projectSwitcher' | 'switchDisabled'
>;

export interface MonitorViewProps {
  /** Where the language and theme are saved; without it they stay in this browser. */
  preferences?: PreferencesEndpoint;
  /** The project switcher in the header; the monitor app names its project in its address. */
  header?: MonitorHeaderProps;
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
  /** The project on the screen, and its open questions for the band; no band without them. */
  projectId?: ProjectId;
  questions?: readonly BandQuestion[];
  /** The answers were saved: the screen reads the project again without waiting. */
  onAnswersSent?(): void;
  /** Read-only resolvers used by the monitor drawer. */
  readResolvers?: MonitorReadResolvers;
  onOpenDetail?(target: MonitorTask, tab: MonitorDetailTab): void;
  /** The first-run guide's link to this screen: it opens the answer sheet and shows the finish notice. */
  guideLink?: PhoneGuideLink;
  /** Told whenever the detail drawer opens or closes; the page does not reload while it is open. */
  onDetailOpenChange?(open: boolean): void;
}

/** What the monitor needs to answer questions: its book of held answers and its two routes. */
export interface MonitorAnswerController {
  book: AnswerBook;
  read: QuestionReader;
  write: AnswersWriter;
}
