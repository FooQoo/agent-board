// The monitor's way into the data layer: one project's routes under `/monitor/api/`.
import type { ProjectId } from '../../shared/api/contracts';
import type { DetailEvent } from '../../shared/data/api';
import { parseChanged, parseSummary } from '../../shared/data/api';
import { ndjsonEvents, type DataAdapter, type EventHandlers } from '../../shared/data/core';
import { readyBuildId } from '../../shared/lib/build/buildId';
import { epicSegment, projectSegment, taskSegment } from './segments';
import {
  MONITOR_API_BASE,
  MONITOR_REQUEST_TIMEOUT_MS,
  MonitorClientError,
  type ErrorBody,
  reportAuthLoss,
  usesMonitorSession,
  type MonitorRequestOptions,
} from './session';

/**
 * The HTTP status a failure carries, if it came from the monitor's server. The data layer wraps a
 * failed Detail read, so the monitor's error may be the `cause` of what the cache holds.
 */
export function monitorErrorStatus(error: unknown): number | null {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current instanceof Error; depth += 1) {
    if (current instanceof MonitorClientError) return current.status;
    current = current.cause;
  }
  return null;
}

/** The error for a refused or unexpected reply, after the phone's loss of access has been reported. */
async function failureOf(path: string, response: Response): Promise<MonitorClientError> {
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    if (usesMonitorSession()) reportAuthLoss('unexpected_response');
    return new MonitorClientError(`GET ${path} was redirected.`, 0, 'unexpected_response');
  }
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
    else if (response.status === 403 && error?.code === 'forbidden') reportAuthLoss('unavailable');
  }
  return new MonitorClientError(
    error?.message ?? `GET ${path} failed with status ${response.status}.`,
    response.status,
    error?.code ?? null,
    error?.reason ?? null,
  );
}

/**
 * One GET. `signal` ends it from outside and `timeoutMs` ends it when no answer comes. A `json`
 * read is timed to the end of the body; a `stream` is read by the caller, and only the wait for
 * its headers is timed.
 */
async function get(
  path: string,
  accept: string,
  options: MonitorRequestOptions,
  mode: 'json' | 'stream',
  read: (response: Response) => Promise<void> | void,
): Promise<void> {
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
  let keepListening = false;

  try {
    let response: Response;
    try {
      response = await fetch(path, {
        headers: { Accept: accept },
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
    if (response.type === 'opaqueredirect' || !response.ok) throw await failureOf(path, response);
    // A stream goes on after this returns, so the caller's signal must still reach the request.
    keepListening = mode === 'stream';
    await read(response);
  } finally {
    clearTimeout(timeout);
    if (!keepListening) externalSignal?.removeEventListener('abort', abortFromCaller);
  }
}

async function readJson<T>(path: string, options: MonitorRequestOptions = {}): Promise<T> {
  let value: T | undefined;
  await get(path, 'application/json', options, 'json', async (response) => {
    try {
      value = (await response.json()) as T;
    } catch (cause) {
      // A 200 that is not JSON is some other page, not monitor data.
      if (!usesMonitorSession()) throw cause;
      reportAuthLoss('unexpected_response');
      throw new MonitorClientError(`GET ${path} did not return JSON.`, 200, 'unexpected_response');
    }
  });
  return value as T;
}

async function* readDetailEvents(path: string, signal: AbortSignal): AsyncGenerator<DetailEvent> {
  let body: ReadableStream<Uint8Array> | null = null;
  await get(path, 'application/x-ndjson', { signal }, 'stream', (response) => {
    body = response.body;
  });
  if (body === null) {
    if (usesMonitorSession()) reportAuthLoss('unexpected_response');
    throw new MonitorClientError(`GET ${path} had no body.`, 200, 'unexpected_response');
  }
  yield* ndjsonEvents(body);
}

/**
 * The monitor's way into the data layer: the routes of one project under `/monitor/api/`. The
 * project is fixed when the adapter is made; it is what to read, not what the phone may read.
 */
export function createMonitorAdapter(projectId: ProjectId): DataAdapter {
  const project = projectSegment(projectId);
  return {
    async fetchSummary(id, signal) {
      if (id !== projectId) throw new TypeError('The monitor reads only its own project.');
      return parseSummary(
        await readJson<unknown>(`${MONITOR_API_BASE}projects/${project}/summary`, { signal }),
      );
    },
    streamDetail({ resource, sections }, signal) {
      if (resource.projectId !== projectId)
        throw new TypeError('The monitor reads only its own project.');
      const owner =
        resource.kind === 'task'
          ? `tasks/${taskSegment(resource.id)}`
          : `epics/${epicSegment(resource.id)}`;
      const query = sections.join(',');
      return readDetailEvents(
        `${MONITOR_API_BASE}projects/${project}/${owner}/detail?sections=${query}`,
        signal,
      );
    },
    openEvents(handlers) {
      return openMonitorEvents(project, handlers);
    },
  };
}

/** The events of one project: `?project=` is required, so the stream never carries another project. */
function openMonitorEvents(project: string, handlers: EventHandlers): () => void {
  let source: EventSource;
  try {
    source = new EventSource(`${MONITOR_API_BASE}events?project=${project}`);
  } catch {
    queueMicrotask(() => handlers.onClose?.());
    return () => {};
  }
  source.addEventListener('ready', (event) => {
    const build = readyBuildId(event);
    if (build !== null) handlers.onReady?.(build);
    handlers.onOpen?.();
  });
  source.addEventListener('changed', (event) => {
    try {
      handlers.onChanged(parseChanged((event as MessageEvent).data));
    } catch {
      handlers.onReset('unknown-event');
    }
  });
  // The server fell behind and dropped events: what the cache holds cannot be trusted.
  source.addEventListener('resync', () => handlers.onReset('seq-gap'));
  source.addEventListener('preferences', (event) => handlers.onPreferences?.(event));
  source.addEventListener('heartbeat', () => handlers.onHeartbeat?.());
  source.addEventListener('error', () => handlers.onClose?.());
  return () => source.close();
}
