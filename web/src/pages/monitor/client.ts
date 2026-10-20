import { i18n } from '../../shared/i18n';
import type { MonitorReadResolvers } from './contracts';
import type { Board, Task, Epic, ProjectId, ProjectList } from '../../shared/api/contracts';
import type { AnswerInput, AnswerResult } from '../../features/tasks/answer/model/answer';
import { writeFailure } from '../../shared/api/writeErrors';

export const MONITOR_API_BASE = '/monitor/api/';
export const MONITOR_REQUEST_TIMEOUT_MS = 10_000;
const MONITOR_TOKEN_META = 'agboard-monitor-token';

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
const attachmentIdPattern = /^[0-9a-f]{32}$/;
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

function taskSegment(value: number): string {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('Invalid monitor task ID.');
  return String(value);
}

function attachmentSegment(value: string): string {
  if (!attachmentIdPattern.test(value)) throw new TypeError('Invalid monitor attachment ID.');
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

function readMonitorToken(): string {
  return (
    document.querySelector<HTMLMetaElement>(`meta[name="${MONITOR_TOKEN_META}"]`)?.content ?? ''
  );
}

async function answerRequest(
  projectId: ProjectId,
  taskId: number,
  input: AnswerInput,
  options: MonitorRequestOptions = {},
): Promise<AnswerResult> {
  const path = `${MONITOR_API_BASE}projects/${projectSegment(projectId)}/tasks/${taskSegment(taskId)}/answer`;
  const controller = new AbortController();
  const externalSignal = options.signal;
  if (externalSignal?.aborted)
    throw externalSignal.reason ?? new DOMException('Aborted', 'AbortError');
  const abortFromCaller = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? MONITOR_REQUEST_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetch(path, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Agboard-Token': readMonitorToken(),
          'X-Agboard-Language': i18n.resolvedLanguage === 'ja' ? 'ja' : 'en',
        },
        cache: 'no-store',
        body: JSON.stringify(input),
        signal: controller.signal,
      });
    } catch (cause) {
      if (externalSignal?.aborted) throw externalSignal.reason ?? cause;
      throw writeFailure(
        timedOut ? 'The monitor answer request timed out.' : 'The monitor answer request failed.',
        0,
        timedOut ? 'timeout' : 'network_error',
      );
    }

    let body: {
      task?: Task & { epicId?: string | null };
      changed?: boolean;
      error?: ErrorBody['error'];
    } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      // Error responses may not contain JSON.
    }
    if (!response.ok || body.task === undefined) {
      throw writeFailure(
        body.error?.reason ?? `The monitor answer request failed (${response.status}).`,
        response.status,
        body.error?.code ?? null,
        body.error?.message ?? null,
      );
    }
    const { epicId: _epicId, ...task } = body.task;
    return { task: task as Task, changed: body.changed ?? true };
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abortFromCaller);
  }
}

export const monitorClient = {
  answerRequest,
  fetchCatalog(options?: MonitorRequestOptions): Promise<ProjectList> {
    return readJson(`${MONITOR_API_BASE}projects`, options);
  },

  fetchBoard(projectId: ProjectId, options?: MonitorRequestOptions): Promise<Board> {
    return readJson(`${MONITOR_API_BASE}projects/${projectSegment(projectId)}/board`, options);
  },

  fetchEpics(projectId: ProjectId, options?: MonitorRequestOptions): Promise<Epic[]> {
    const path = `${MONITOR_API_BASE}projects/${projectSegment(projectId)}/epics`;
    return readJson<{ epics: Epic[] }>(path, options).then(({ epics }) => epics);
  },
};

export const monitorReadResolvers: MonitorReadResolvers = {
  attachmentUrl: (projectId, taskId, attachmentId) =>
    `${MONITOR_API_BASE}projects/${projectSegment(projectId)}/tasks/${taskSegment(taskId)}/attachments/${attachmentSegment(attachmentId)}`,
  epicAttachmentUrl: (projectId, epicId, attachmentId) =>
    `${MONITOR_API_BASE}projects/${projectSegment(projectId)}/epics/${epicSegment(epicId)}/attachments/${attachmentSegment(attachmentId)}`,
  getEpics: (projectId, signal) => monitorClient.fetchEpics(projectId, { signal }),
};
