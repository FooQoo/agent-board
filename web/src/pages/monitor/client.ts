import { i18n } from '../../shared/i18n';
import type { MonitorReadResolvers } from './contracts';
import type { Task, ProjectId } from '../../shared/api/contracts';
import type { AnswerInput, AnswerResult } from '../../features/tasks/answer/model/answer';
import { writeFailure } from '../../shared/api/writeErrors';
import { attachmentSegment, epicSegment, projectSegment, taskSegment } from './segments';
import {
  MONITOR_API_BASE,
  MONITOR_REQUEST_TIMEOUT_MS,
  MonitorClientError,
  type ErrorBody,
  openSession,
  readMonitorToken,
  reportAuthLoss,
  currentCsrf,
  forgetCsrf,
  unlock,
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

export { createMonitorAdapter, monitorErrorStatus } from './adapter';

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
      if (cause instanceof MonitorClientError) {
        // Without a live session the page asks for the passcode again.
        if (cause.code === 'session_required') reportAuthLoss('session_required');
        throw writeFailure(
          'The monitor answer request failed.',
          cause.status,
          cause.code === 'unexpected_response' ? 'session_required' : cause.code,
        );
      }
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
      reportAuthLoss(response.status === 401 ? 'session_required' : 'unexpected_response');
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
  unlock,
};

export const monitorReadResolvers: MonitorReadResolvers = {
  attachmentUrl: (projectId, taskId, attachmentId) =>
    `${MONITOR_API_BASE}projects/${projectSegment(projectId)}/tasks/${taskSegment(taskId)}/attachments/${attachmentSegment(attachmentId)}`,
  epicAttachmentUrl: (projectId, epicId, attachmentId) =>
    `${MONITOR_API_BASE}projects/${projectSegment(projectId)}/epics/${epicSegment(epicId)}/attachments/${attachmentSegment(attachmentId)}`,
};
