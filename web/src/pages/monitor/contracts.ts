import type { ReactNode } from 'react';
import type { ColumnName, Task, ProjectId } from '../../shared/api/contracts';
import type { PreferencesEndpoint } from '../../shared/preferences';
import type { PhoneGuideLink } from '../../features/onboarding/model/phoneGuideLink';
import type { HeaderProps, HeaderSettings } from '../../shared/ui/app-header/Header';
import type { MessagesApi } from '../../features/tasks/messages/model/messages';
import type { ResultLinkTarget } from '../../features/tasks/results/resultLink';
import type { Message } from '../../shared/data/api/contracts';

export interface MonitorTask {
  projectId: ProjectId;
  projectName: string;
  task: Task;
}

export type MonitorSummary = { backlog: number; todo: number; doing: number; done: number } | null;
export type MonitorDetailTab = 'description' | 'acceptance' | 'results' | 'history' | 'epic';
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
    `/api/projects/${encodeURIComponent(projectId)}/tasks/${taskId}/attachments/${encodeURIComponent(attachmentId)}`,
  epicAttachmentUrl: (projectId, epicId, attachmentId) =>
    `/api/projects/${encodeURIComponent(projectId)}/epics/${encodeURIComponent(epicId)}/attachments/${encodeURIComponent(attachmentId)}`,
};

/**
 * The changes the lane view makes: a move at once, the archive of one card, and the archive of
 * the done lane, the last two after the person confirmed them. They go to the board's own routes.
 */
export interface MonitorWrites {
  move(
    projectId: ProjectId,
    taskId: number,
    target: ColumnName,
    /** The status the page showed; a task that has moved on since is refused. */
    fromStatus: ColumnName,
  ): Promise<unknown>;
  /** Puts a card before `beforeId` in its lane, or at the end when it is null. */
  archive(projectId: ProjectId, taskId: number): Promise<unknown>;
  archiveDone(projectId: ProjectId, ids: readonly number[]): Promise<unknown>;
  /** Returns an archived task to the lane it was archived from. */
  restore(projectId: ProjectId, taskId: number): Promise<unknown>;
}

/** The project switcher the header shows when the app lets the person change project. */
export type MonitorHeaderProps = Pick<
  HeaderProps,
  'projects' | 'activeProjectId' | 'projectSwitcher' | 'switchDisabled'
>;

export interface MonitorViewProps {
  /** The result a link points at: the drawer opens on it once its task is listed. */
  resultLink?: ResultLinkTarget | null;
  /** The drawer of the link's task was closed: the app takes the link out of the address. */
  onResultLinkClose?: () => void;
  /** Where the language and theme are saved; without it they stay in this browser. */
  preferences?: PreferencesEndpoint;
  /** The header's settings dialog; without it, the plain one that saves through `preferences`. */
  settings?: HeaderSettings;
  /** The project switcher in the header; the monitor app names its project in its address. */
  header?: MonitorHeaderProps;
  summary: MonitorSummary;
  backlog: MonitorTask[];
  todo: MonitorTask[];
  doing: MonitorTask[];
  done: MonitorTask[];
  freshness: MonitorFreshness;
  /** A person pulled a lane down for fresh data: the screen asks the server now, without the presentation hold. */
  onRefresh(): void;
  /** True while that request runs; the lanes show the refreshing indicator. */
  refreshing?: boolean;
  /** A display-only indicator in the status line after the connection state (the resident agent). */
  statusSlot?: ReactNode;
  /** The project on the screen, its open messages and the routes for the band; no band without them. */
  projectId?: ProjectId;
  messages?: readonly Message[];
  messagesApi?: MessagesApi;
  /** An answer or a withdrawal was saved: the screen reads the project again without waiting. */
  onMessagesChanged?(): void;
  /** The address asks for the messages on the Summary tab: the list opens on it once. */
  summaryLink?: boolean;
  /** The list that opened for that request was closed. */
  onSummaryLinkClose?(): void;
  /** The bar's Ask item opens "Ask AI"; the screen leaves it to this callback. */
  onAsk?(): void;
  /**
   * The bar leaves the Ask sheet: it closes through its discard question and calls `then` only once
   * it has closed. A person who keeps the request stays on Ask and `then` is never called.
   */
  onAskClose?(then: () => void): void;
  /** The Ask sheet is open, so the bar shows Ask as the open item. */
  asking?: boolean;
  /** Read-only resolvers used by the monitor drawer. */
  readResolvers?: MonitorReadResolvers;
  onOpenDetail?(target: MonitorTask, tab: MonitorDetailTab): void;
  /** The first-run guide's link to this screen: it asks for the lane its step is about. */
  guideLink?: PhoneGuideLink;
  /** Told whenever the detail drawer opens or closes; the page does not reload while it is open. */
  onDetailOpenChange?(open: boolean): void;
  /** Told whenever the list of messages opens or closes; an answer being written would be lost by a reload. */
  onMessagesOpenChange?(open: boolean): void;
  /** Moves and archives from the lanes; without them the lanes only read. */
  writes?: MonitorWrites;
  /** The project's name, which the archive confirmations show. */
  projectName?: string;
  /** A move or an archive was saved: the screen reads the project again without waiting. */
  onWritten?(): void;
}
