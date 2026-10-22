// Serves a sample project the way the monitor's server would, for the sample-data mode, the stories and tests.
import type { DetailEvent, DetailSection } from '../../shared/data/api';
import type { DataAdapter, DetailRequest, EventHandlers } from '../../shared/data/core';
import type { MonitorFixture } from './mock';

export interface FixtureAdapterOptions {
  /** Every Detail read fails, for the failure states. */
  failDetail?: boolean;
  /** Only an epic read fails. */
  failEpic?: boolean;
  /** What a failed read fails with. */
  detailError?: Error;
  /** Detail reads wait this long (ms) before the stream starts. */
  detailDelayMs?: number;
  /** A Detail stream stops after this many events and never finishes, to show a document that is still arriving. */
  stallAfter?: number;
  /** The Summary read fails with this error. */
  summaryError?: Error;
  /** Called with every request, for stories and tests that count them. */
  onRequest?(request: { kind: 'summary' | 'detail'; detail?: DetailRequest }): void;
}

function* taskEvents(fixture: MonitorFixture, id: number, sections: DetailSection[]) {
  const task = fixture.tasks.get(id);
  if (!task) throw new Error('No such task.');
  const versions = {
    ...(sections.includes('document') ? { document: task.summary.detailVersions.document } : {}),
    ...(sections.includes('history') ? { history: task.summary.detailVersions.history } : {}),
  };
  yield {
    type: 'start',
    resource: 'task',
    id,
    projectId: fixture.projectId,
    sections,
    versions,
  } satisfies DetailEvent;
  if (sections.includes('document')) {
    yield { type: 'section-start', section: 'document' } satisfies DetailEvent;
    for (const block of task.blocks) yield { type: 'block', ...block } satisfies DetailEvent;
    for (const item of task.acceptance) yield { type: 'acceptance', ...item } satisfies DetailEvent;
    yield {
      type: 'section-end',
      section: 'document',
      count: task.blocks.length + task.acceptance.length,
    } satisfies DetailEvent;
  }
  if (sections.includes('history')) {
    yield { type: 'section-start', section: 'history' } satisfies DetailEvent;
    for (const item of task.history) yield { type: 'history-item', ...item } satisfies DetailEvent;
    yield {
      type: 'section-end',
      section: 'history',
      count: task.history.length,
    } satisfies DetailEvent;
  }
  yield { type: 'complete', versions } satisfies DetailEvent;
}

function* epicEvents(fixture: MonitorFixture, id: string) {
  const versions = { document: 'e1' };
  yield {
    type: 'start',
    resource: 'epic',
    id,
    projectId: fixture.projectId,
    sections: ['document'],
    versions,
  } satisfies DetailEvent;
  yield { type: 'section-start', section: 'document' } satisfies DetailEvent;
  for (const block of fixture.epicBlocks) yield { type: 'block', ...block } satisfies DetailEvent;
  yield {
    type: 'section-end',
    section: 'document',
    count: fixture.epicBlocks.length,
  } satisfies DetailEvent;
  yield { type: 'complete', versions } satisfies DetailEvent;
}

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });

const never = (signal: AbortSignal) =>
  new Promise<void>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
      once: true,
    });
  });

/** Serves a fixture the way the monitor's server would: no network, no session, no changes. */
export function createMonitorFixtureAdapter(
  fixture: MonitorFixture,
  options: FixtureAdapterOptions = {},
): DataAdapter {
  return {
    async fetchSummary() {
      options.onRequest?.({ kind: 'summary' });
      if (options.summaryError) throw options.summaryError;
      return fixture.summary;
    },
    async *streamDetail(request, signal) {
      options.onRequest?.({ kind: 'detail', detail: request });
      if (options.detailDelayMs) await wait(options.detailDelayMs, signal);
      if (options.failDetail || (options.failEpic && request.resource.kind === 'epic'))
        throw options.detailError ?? new Error('offline');
      const events =
        request.resource.kind === 'task'
          ? taskEvents(fixture, request.resource.id, request.sections)
          : epicEvents(fixture, request.resource.id);
      let sent = 0;
      for (const event of events) {
        yield event;
        sent += 1;
        if (options.stallAfter !== undefined && sent >= options.stallAfter) await never(signal);
      }
    },
    openEvents(handlers: EventHandlers) {
      const open = setTimeout(() => handlers.onOpen?.(), 0);
      const beat = setInterval(() => handlers.onHeartbeat?.(), 15_000);
      return () => {
        clearTimeout(open);
        clearInterval(beat);
      };
    },
  };
}
