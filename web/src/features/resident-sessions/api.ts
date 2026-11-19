import { i18n } from '../../shared/i18n';
import { authHeaders, FetchError, getJson, projectPath } from '../../shared/api/http';
import type { ApiError, ProjectId } from '../../shared/api/contracts';

/** The tools the board can launch. */
export type SessionTool = 'claude-code' | 'codex';

/** The saved choice of the session that starts with the server. */
export interface AutoStart {
  tool: SessionTool;
  projectId: string;
  model: string | null;
}

/** The single health object of the board's one session slot (`state` is the launcher's, not the badge's). */
/** An item the board pushed to the session several times without it being handled. */
export interface StalledItem {
  kind: 'request' | 'answer' | 'task';
  /** The request or question ID such as Q-3, or the task number as text. */
  id: string;
  attempts: number;
  /** How the last turn failed, when it did. */
  lastError: string | null;
}

export interface SessionHealth {
  tool: SessionTool | null;
  state: 'running' | 'restarting' | 'failed' | 'stopped';
  projectId: string | null;
  model: string | null;
  reason: string | null;
  /** True while the session's wait is registered; a running session with false is working on a task. */
  waiting: boolean;
  /** Items the board gave up pushing after several attempts. */
  pushStalled: StalledItem[];
  restartCount: number;
  lastExitAt: string | null;
  nextRestartAt: string | null;
  autoStart: AutoStart | null;
}

export interface AttachedSession {
  id: string;
  tool: SessionTool | 'unknown';
  origin: 'board' | 'external';
  connectedAt: string;
  lastSeenAt: string;
  state: 'connected' | 'grace';
}

export interface LaunchedSession {
  tool: SessionTool;
  projectId: string;
  model: string | null;
  startedAt: string;
}

/** What `GET /api/projects/{id}/sessions` returns. */
export interface SessionsSnapshot {
  sessions: AttachedSession[];
  counts: {
    total: number;
    connected: number;
    byOrigin: { board: number; external: number };
  };
  launched: LaunchedSession[];
  health: SessionHealth;
}

export interface ModelOption {
  id: string;
  label: string;
}

export interface ModelList {
  models: ModelOption[];
  /** Why the list could not be read; the launch then uses the tool's default model. */
  reason: string | null;
}

/** A request the server refused, or one that never got an answer (`status` 0). */
export class ResidentRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    /** The server's one-line reason, in the language the request asked for. */
    readonly reason: string | null,
  ) {
    super(`session request failed (${status}${code ? ` ${code}` : ''})`);
  }
}

const sessionsPath = (projectId: ProjectId) => `${projectPath(projectId)}/sessions`;

async function failure(response: Response): Promise<ResidentRequestError> {
  let body: Partial<ApiError> = {};
  try {
    body = (await response.json()) as Partial<ApiError>;
  } catch {
    // The body was not JSON.
  }
  return new ResidentRequestError(
    response.status,
    body.error?.code ?? null,
    body.error?.reason ?? body.error?.message ?? null,
  );
}

async function read<T>(path: string): Promise<T> {
  try {
    return await getJson<T>(path);
  } catch (cause) {
    if (cause instanceof FetchError) throw new ResidentRequestError(cause.status, cause.code, null);
    throw new ResidentRequestError(0, null, null);
  }
}

async function write<T>(method: 'POST' | 'PUT', path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...authHeaders(),
        'X-Agboard-Language': i18n.resolvedLanguage === 'ja' ? 'ja' : 'en',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ResidentRequestError(0, null, null);
  }
  if (!response.ok) throw await failure(response);
  return (await response.json()) as T;
}

/** The sessions of a project, with the health of the board's session. Served through the entrance too. */
export const getSessions = (projectId: ProjectId) =>
  read<SessionsSnapshot>(sessionsPath(projectId));

/** The models a tool offers. Local only. A missing CLI is `agent_cli_missing`. */
export const getModels = (projectId: ProjectId, tool: SessionTool) =>
  read<ModelList>(`${sessionsPath(projectId)}/models?tool=${encodeURIComponent(tool)}`);

/** Starts the session. An empty model leaves the choice to the tool. Local only. */
export const launchSession = (projectId: ProjectId, tool: SessionTool, model: string) =>
  write<{ launched: LaunchedSession }>('POST', `${sessionsPath(projectId)}/launch`, {
    tool,
    ...(model === '' ? {} : { model }),
  });

/** Stops the launched session (one in total). Local only. */
export const stopSession = (projectId: ProjectId) =>
  write<{ stopped: boolean }>('POST', `${sessionsPath(projectId)}/stop`, {});

/** Saves whether and how a session starts with the server. Local only. */
export const saveAutoStart = (
  projectId: ProjectId,
  input: { enabled: false } | { enabled: true; tool: SessionTool; model: string },
) =>
  write<{ autoStart: AutoStart | null }>('PUT', `${sessionsPath(projectId)}/autostart`, {
    enabled: input.enabled,
    ...(input.enabled
      ? { tool: input.tool, ...(input.model === '' ? {} : { model: input.model }) }
      : {}),
  });
