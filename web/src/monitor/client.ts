import type { MonitorReadResolvers } from './contracts';
import type { Board, Epic, ProjectId, ProjectList } from '../types';

export const MONITOR_API_BASE = '/monitor/api/';
export const MONITOR_REQUEST_TIMEOUT_MS = 10_000;

export interface MonitorRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface ErrorBody {
  error?: { code?: string; message?: string; reason?: string };
}

export class MonitorClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly reason: string | null = null,
  ) {
    super(message);
    this.name = 'MonitorClientError';
  }
}

const projectIdPattern = /^[0-9a-f]{32}$/;
const evidenceIdPattern = /^[0-9a-f]{32}$/;
const epicIdPattern = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;

function projectSegment(value: ProjectId): string {
  if (!projectIdPattern.test(value)) throw new TypeError('Invalid monitor project ID.');
  return encodeURIComponent(value);
}

function epicSegment(value: string): string {
  if (value.length > 64 || !epicIdPattern.test(value))
    throw new TypeError('Invalid monitor epic ID.');
  return encodeURIComponent(value);
}

function cardSegment(value: number): string {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('Invalid monitor card ID.');
  return String(value);
}

function attachmentSegment(value: string): string {
  if (!evidenceIdPattern.test(value)) throw new TypeError('Invalid monitor attachment ID.');
  return encodeURIComponent(value);
}

function evidenceSegment(value: string): string {
  if (!evidenceIdPattern.test(value)) throw new TypeError('Invalid monitor evidence ID.');
  return encodeURIComponent(value);
}

async function readJson<T>(path: string, options: MonitorRequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const externalSignal = options.signal;
  if (externalSignal?.aborted)
    throw externalSignal.reason ?? new DOMException('Aborted', 'AbortError');

  const abortFromCaller = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeoutMs = options.timeoutMs ?? MONITOR_REQUEST_TIMEOUT_MS;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch(path, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      });
    } catch (cause) {
      if (externalSignal?.aborted) throw externalSignal.reason ?? cause;
      if (timedOut)
        throw new MonitorClientError(`GET ${path} timed out.`, 0, 'timeout', 'Request timed out.');
      throw new MonitorClientError(
        `GET ${path} failed.`,
        0,
        'network_error',
        'Network request failed.',
      );
    }

    if (!response.ok) {
      let body: ErrorBody = {};
      try {
        body = (await response.json()) as ErrorBody;
      } catch {
        // Error responses may not contain JSON.
      }
      const error = body.error;
      throw new MonitorClientError(
        error?.message ?? `GET ${path} failed with status ${response.status}.`,
        response.status,
        error?.code ?? null,
        error?.reason ?? null,
      );
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abortFromCaller);
  }
}

export const monitorClient = {
  fetchCatalog(options?: MonitorRequestOptions): Promise<ProjectList> {
    return readJson(`${MONITOR_API_BASE}projects`, options);
  },

  fetchBoard(projectId: ProjectId, options?: MonitorRequestOptions): Promise<Board> {
    return readJson(`${MONITOR_API_BASE}projects/${projectSegment(projectId)}/board`, options);
  },

  fetchEpic(projectId: ProjectId, epicId: string, options?: MonitorRequestOptions): Promise<Epic> {
    const path = `${MONITOR_API_BASE}projects/${projectSegment(projectId)}/epics/${epicSegment(epicId)}`;
    return readJson<{ epic: Epic }>(path, options).then(({ epic }) => epic);
  },
};

export const monitorReadResolvers: MonitorReadResolvers = {
  attachmentUrl: (projectId, cardId, attachmentId) =>
    `${MONITOR_API_BASE}projects/${projectSegment(projectId)}/cards/${cardSegment(cardId)}/attachments/${attachmentSegment(attachmentId)}`,
  evidenceUrl: (projectId, cardId, evidenceId) =>
    `${MONITOR_API_BASE}projects/${projectSegment(projectId)}/cards/${cardSegment(cardId)}/evidence/${evidenceSegment(evidenceId)}`,
  epicAttachmentUrl: (projectId, epicId, attachmentId) =>
    `${MONITOR_API_BASE}projects/${projectSegment(projectId)}/epics/${epicSegment(epicId)}/attachments/${attachmentSegment(attachmentId)}`,
  getEpic: (projectId, epicId, signal) => monitorClient.fetchEpic(projectId, epicId, { signal }),
};
