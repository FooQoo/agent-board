import { i18n } from '../../shared/i18n';
import type { MonitorReadResolvers } from './contracts';
import type { Board, Task, Epic, ProjectId, ProjectList } from '../../shared/api/contracts';
import type { AnswerInput, AnswerResult } from '../../features/tasks/answer/model/answer';
import { writeFailure } from '../../shared/api/writeErrors';
import {
  MONITOR_API_BASE,
  MONITOR_REQUEST_TIMEOUT_MS,
  MonitorClientError,
  openSession,
  readMonitorToken,
  reportAuthLoss,
  currentCsrf,
  forgetCsrf,
  usesMonitorSession,
  type MonitorRequestOptions,
} from './session';

export {
  MONITOR_API_BASE,
  MONITOR_REQUEST_TIMEOUT_MS,
  MonitorClientError,
  onMonitorAuthLoss,
  usesMonitorSession,
  type MonitorAuthLoss,
  type MonitorRequestOptions,
  type MonitorSession,
} from './session';

interface ErrorBody {
  error?: { code?: string; message?: string; reason?: string };
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
        redirect: 'manual',
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

    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      if (usesMonitorSession()) reportAuthLoss('auth_redirect');
      throw new MonitorClientError(`GET ${path} was redirected.`, 0, 'auth_redirect');
    }

    if (!response.ok) {
      let body: ErrorBody = {};
      try {
        body = (await response.json()) as ErrorBody;
      } catch {
        // Error responses may not contain JSON.
      }
      const error = body.error;
      if (usesMonitorSession()) {
        if (response.status === 401 && error?.code === 'session_required')
          reportAuthLoss('session_required');
        else if (response.status === 403 && error?.code === 'forbidden')
          reportAuthLoss('unavailable');
      }
      throw new MonitorClientError(
        error?.message ?? `GET ${path} failed with status ${response.status}.`,
        response.status,
        error?.code ?? null,
        error?.reason ?? null,
      );
    }
    try {
      return (await response.json()) as T;
    } catch (cause) {
      // A 200 that is not JSON is the Edge's sign-in page, not monitor data.
      if (!usesMonitorSession()) throw cause;
      reportAuthLoss('auth_redirect');
      throw new MonitorClientError(`GET ${path} did not return JSON.`, 200, 'auth_redirect');
    }
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abortFromCaller);
  }
}

async function answerRequest(
  projectId: ProjectId,
  taskId: number,
  input: AnswerInput,
  options: MonitorRequestOptions = {},
): Promise<AnswerResult> {
  const path = `${MONITOR_API_BASE}projects/${projectSegment(projectId)}/tasks/${taskSegment(taskId)}/answer`;
  const session = usesMonitorSession();
  if (session && currentCsrf() === null) {
    try {
      await openSession(options);
    } catch (cause) {
      if (cause instanceof MonitorClientError)
        throw writeFailure(
          'The monitor answer request failed.',
          cause.status,
          cause.code === 'auth_redirect' ? 'session_required' : cause.code,
        );
      throw cause;
    }
  }
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
          ...(session
            ? { 'X-Agboard-Csrf': currentCsrf() ?? '' }
            : { 'X-Agboard-Token': readMonitorToken() }),
          'X-Agboard-Language': i18n.resolvedLanguage === 'ja' ? 'ja' : 'en',
        },
        cache: 'no-store',
        redirect: 'manual',
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

    if (session && (response.type === 'opaqueredirect' || response.status === 401)) {
      reportAuthLoss(response.status === 401 ? 'session_required' : 'auth_redirect');
      throw writeFailure('The monitor answer request failed.', response.status, 'session_required');
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
      // A refused write may mean the CSRF token is stale; fetch a new one before the next try.
      if (session && response.status === 403) forgetCsrf();
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
  openSession,
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
