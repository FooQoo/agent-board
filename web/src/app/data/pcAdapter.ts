import type { ProjectId } from '../../shared/api/contracts';
import { FetchError, projectPath } from '../../shared/api/http';
import { readyBuildId } from '../../shared/lib/build/buildId';
import {
  type ChangedEvent,
  type DetailEvent,
  parseChanged,
  parseSummary,
  type Summary,
} from '../../shared/data/api';
import {
  type DataAdapter,
  type DetailRequest,
  type EventHandlers,
  ndjsonEvents,
} from '../../shared/data/core';

const EVENTS_URL = '/api/events';
/** How often a live connection reports a sign of life. The browser hides the server's comment lines. */
const ALIVE_MS = 15_000;
const EVENT_SOURCE_OPEN = 1;

/** What the app learns from the stream besides what the data core uses. */
export type PcStreamNote =
  | { type: 'changed'; event: ChangedEvent }
  /** The stream opened, or the cache can no longer be trusted: lists the core does not own are read again. */
  | { type: 'sync' }
  /** Files in a project's Docs changed; `null` when any project's Docs may have. */
  | { type: 'docs'; projectId: string | null };

export interface PcAdapter extends DataAdapter {
  /** Listens to the notes of every stream this adapter opens. Returns the function that stops it. */
  subscribe(listener: (note: PcStreamNote) => void): () => void;
}

async function failure(response: Response, path: string): Promise<FetchError> {
  let code: string | null = null;
  try {
    code = ((await response.json()) as { error?: { code?: string } }).error?.code ?? null;
  } catch {
    // The body was not JSON.
  }
  return new FetchError(`GET ${path} failed with status ${response.status}`, response.status, code);
}

function detailPath(request: DetailRequest): string {
  const { resource } = request;
  const base = projectPath(resource.projectId);
  const sections = `sections=${request.sections.join(',')}`;
  return resource.kind === 'task'
    ? `${base}/tasks/${resource.id}/detail?${sections}`
    : `${base}/epics/${encodeURIComponent(resource.id)}/detail?${sections}`;
}

/**
 * The PC board's side of the data layer: the Summary, the Detail stream and the change
 * notifications, all from the board's own server. Reads need no token. Writes keep the page-token
 * header they already send (`shared/api`) and do not pass through here.
 */
export function createPcAdapter(): PcAdapter {
  const listeners = new Set<(note: PcStreamNote) => void>();
  /** Whether a stream of this adapter has been open before; the first open needs no extra reading. */
  let opened = false;
  const tell = (note: PcStreamNote) => {
    for (const listener of [...listeners]) listener(note);
  };

  return {
    async fetchSummary(projectId: ProjectId, signal: AbortSignal): Promise<Summary> {
      const path = `${projectPath(projectId)}/summary`;
      const response = await fetch(path, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal,
      });
      if (!response.ok) throw await failure(response, path);
      return parseSummary(await response.json());
    },

    async *streamDetail(request: DetailRequest, signal: AbortSignal): AsyncGenerator<DetailEvent> {
      const path = detailPath(request);
      const response = await fetch(path, {
        headers: { Accept: 'application/x-ndjson' },
        cache: 'no-store',
        signal,
      });
      if (!response.ok) throw await failure(response, path);
      if (!response.body) throw new FetchError(`GET ${path} had no body`, response.status, null);
      yield* ndjsonEvents(response.body);
    },

    openEvents(handlers: EventHandlers): () => void {
      const source = new EventSource(EVENTS_URL);
      const alive = setInterval(() => {
        if (source.readyState === EVENT_SOURCE_OPEN) handlers.onHeartbeat?.();
      }, ALIVE_MS);
      source.addEventListener('ready', (event) => {
        handlers.onOpen?.();
        handlers.onReady?.(readyBuildId(event) ?? '');
        if (opened) tell({ type: 'sync' });
        opened = true;
      });
      source.addEventListener('changed', (event) => {
        let parsed: ChangedEvent;
        try {
          parsed = parseChanged((event as MessageEvent).data);
        } catch {
          handlers.onReset('unknown-event');
          tell({ type: 'sync' });
          return;
        }
        handlers.onChanged(parsed);
        tell({ type: 'changed', event: parsed });
      });
      source.addEventListener('resync', () => {
        handlers.onReset('seq-gap');
        tell({ type: 'sync' });
      });
      source.addEventListener('preferences', (event) => handlers.onPreferences?.(event));
      source.addEventListener('docs', (event) => {
        let projectId: string | null = null;
        try {
          const data: unknown = JSON.parse((event as MessageEvent).data);
          const named = (data as { projectId?: unknown } | null)?.projectId;
          if (typeof named === 'string') projectId = named;
        } catch {
          // An unreadable notice still says that some Docs changed.
        }
        tell({ type: 'docs', projectId });
      });
      source.addEventListener('error', () => handlers.onClose?.());
      return () => {
        clearInterval(alive);
        source.close();
      };
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
