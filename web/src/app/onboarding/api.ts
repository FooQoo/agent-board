// The guide's requests to the PC board's routes. The server names every change by a
// command ID and the revision the tab last read, so each call here carries both.

import { i18n } from '../../shared/i18n';
import type { ProjectId } from '../../shared/api/contracts';
import { projectPath, readToken } from '../../shared/api/http';

export type GuideStatus =
  | 'unseen'
  | 'offered'
  | 'active'
  | 'closing'
  | 'completed'
  | 'interrupted'
  | 'skipped';

export type GuidePhase =
  | 'samples'
  | 'first-running'
  | 'first-done'
  | 'question'
  | 'second-running'
  | 'second-done'
  | 'complete';

export type GuideTransition =
  | 'first-running'
  | 'first-done'
  | 'ask-question'
  | 'resume-second'
  | 'second-done'
  | 'complete';

export interface GuideRunState {
  runId: string;
  attemptId: string;
  projectId: string;
  locale: 'en' | 'ja';
  sampleIds: number[];
  phase: GuidePhase;
  questionRequestId: string | null;
  closingReason: string | null;
}

/** `GET /api/onboarding` and every write answer: the guide's file as the server holds it. */
export interface GuideState {
  formatVersion: number;
  revision: number;
  status: GuideStatus;
  owner: { clientId: string; leaseUntil: string } | null;
  run: GuideRunState | null;
  appliedCommands: string[];
}

/** A refused request: the server's code and reason, with the HTTP status. */
export class GuideError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly reason: string,
  ) {
    super(reason);
  }
}

/** A value that is unique for one guide action, so that a retry is recognised. */
export function newId(): string {
  return crypto.randomUUID();
}

async function send(path: string, body?: unknown): Promise<GuideState> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      'X-Agboard-Token': readToken(),
      'X-Agboard-Language': i18n.resolvedLanguage === 'ja' ? 'ja' : 'en',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    const error = (parsed as { error?: { code?: string; reason?: string } } | null)?.error;
    throw new GuideError(
      response.status,
      error?.code ?? 'request_failed',
      error?.reason ?? `Request failed (${response.status})`,
    );
  }
  return parsed as GuideState;
}

export function readGuide(): Promise<GuideState> {
  return send('/api/onboarding');
}

export function claimGuide(clientId: string, expectedRevision: number): Promise<GuideState> {
  return send('/api/onboarding/claim', { clientId, expectedRevision });
}

/** The run's phase, or null when no run is active. */
export function phaseOf(state: GuideState | null): string | null {
  return state?.run?.phase ?? null;
}

export function replayGuide(clientId: string, expectedRevision: number): Promise<GuideState> {
  return send('/api/onboarding/replay', { clientId, expectedRevision });
}

export function heartbeatGuide(clientId: string): Promise<GuideState> {
  return send('/api/onboarding/heartbeat', { clientId });
}

export function skipGuide(
  clientId: string,
  expectedRevision: number,
  commandId: string,
): Promise<GuideState> {
  return send('/api/onboarding/skip', { clientId, expectedRevision, commandId });
}

export function recoverGuide(): Promise<GuideState> {
  return send('/api/onboarding/recover', {});
}

export function startGuide(
  projectId: ProjectId,
  input: { clientId: string; attemptId: string; expectedRevision: number; locale: 'en' | 'ja' },
): Promise<GuideState> {
  return send(`${projectPath(projectId)}/onboarding/start`, input);
}

export function advanceGuide(
  projectId: ProjectId,
  runId: string,
  input: {
    clientId: string;
    expectedRevision: number;
    commandId: string;
    transition: GuideTransition;
  },
): Promise<GuideState> {
  return send(`${projectPath(projectId)}/onboarding/${runId}/advance`, input);
}

export function finishGuide(
  projectId: ProjectId,
  runId: string,
  input: { clientId: string; expectedRevision: number; commandId: string },
): Promise<GuideState> {
  return send(`${projectPath(projectId)}/onboarding/${runId}/finish`, input);
}

export function abortGuide(
  projectId: ProjectId,
  runId: string,
  input: { clientId: string; expectedRevision: number; commandId: string },
): Promise<GuideState> {
  return send(`${projectPath(projectId)}/onboarding/${runId}/abort`, input);
}
