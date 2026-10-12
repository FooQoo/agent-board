import type { Card, Epic, Project, ProjectId } from '../types';
import type { MonitorAnswerController } from './hooks/useMonitorInteractions';

export interface MonitorCard {
  projectId: ProjectId;
  projectName: string;
  card: Card;
}

export type MonitorScope = 'all' | ProjectId;
export type MonitorSummary = { todo: number; doing: number; done: number } | null;
export type MonitorDetailTab = 'description' | 'epic';
export type MonitorFreshnessState = 'loading' | 'syncing' | 'fresh' | 'stale' | 'partial' | 'error';

export interface MonitorFreshness {
  state: MonitorFreshnessState;
  lastFetchedAt: string | null;
  failedProjectIds: ProjectId[];
  snapshotProblems: Array<{ projectId: ProjectId; file: string; field: string; reason: string }>;
}

export interface MonitorReadResolvers {
  attachmentUrl(projectId: ProjectId, cardId: number, attachmentId: string): string;
  evidenceUrl(projectId: ProjectId, cardId: number, evidenceId: string): string;
  epicAttachmentUrl(projectId: ProjectId, epicId: string, attachmentId: string): string;
  getEpic(projectId: ProjectId, epicId: string, signal?: AbortSignal): Promise<Epic>;
}

/** Explicitly unconnected U1 resolvers. U4 supplies the live read-only API adapter. */
export const unconnectedMonitorReadResolvers: MonitorReadResolvers = {
  attachmentUrl: (projectId, cardId, attachmentId) =>
    `/monitor/api/projects/${encodeURIComponent(projectId)}/cards/${cardId}/attachments/${encodeURIComponent(attachmentId)}`,
  evidenceUrl: (projectId, cardId, evidenceId) =>
    `/monitor/api/projects/${encodeURIComponent(projectId)}/cards/${cardId}/evidence/${encodeURIComponent(evidenceId)}`,
  epicAttachmentUrl: (projectId, epicId, attachmentId) =>
    `/monitor/api/projects/${encodeURIComponent(projectId)}/epics/${encodeURIComponent(epicId)}/attachments/${encodeURIComponent(attachmentId)}`,
  getEpic: async () => {
    throw new Error('Monitor epic resolver is not connected.');
  },
};

export const MONITOR_API_BASE = '/monitor/api/';

export interface MonitorViewProps {
  projects: Project[];
  scope: MonitorScope;
  summary: MonitorSummary;
  todo: MonitorCard[];
  doing: MonitorCard[];
  done: MonitorCard[];
  freshness: MonitorFreshness;
  onScopeChange(scope: MonitorScope): void;
  onRefresh(): void;
  answerController?: MonitorAnswerController;
  scopeLocked?: boolean;
  /** The monitor drawer is connected by a later UoW; omitted means detail actions are disabled. */
  onOpenDetail?(target: MonitorCard, tab: MonitorDetailTab): void;
  routeNotice?: boolean;
}
