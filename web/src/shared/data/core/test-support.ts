// Builders shared by the tests of the data core. Not part of the product.
import type { DetailEvent, DetailVersions, Summary } from '../api/contracts';
import type { DocumentData, HistoryData, ResourceKey } from './types';

export const P = 'p1';

export const task = (id: number, projectId = P): ResourceKey => ({ kind: 'task', projectId, id });
export const epic = (id: string, projectId = P): ResourceKey => ({ kind: 'epic', projectId, id });

export const doc = (text = 'body'): DocumentData => ({
  blocks: [{ kind: 'markdown', text }],
  acceptance: [],
});
export const hist = (...reasons: string[]): HistoryData => ({
  items: reasons.map((reason, i) => ({ at: `2026-01-01T00:00:0${i}Z`, reason })),
});

/** The events of a whole task Detail stream with the given sections and versions. */
export function taskStream(
  id: number,
  versions: DetailVersions,
  content: { text?: string; reasons?: string[]; projectId?: string } = {},
): DetailEvent[] {
  const sections = (['document', 'history'] as const).filter((s) => versions[s] !== undefined);
  const out: DetailEvent[] = [
    {
      type: 'start',
      resource: 'task',
      id,
      projectId: content.projectId ?? P,
      sections: [...sections],
      versions,
    },
  ];
  if (versions.document !== undefined) {
    out.push(
      { type: 'section-start', section: 'document' },
      { type: 'block', kind: 'markdown', text: content.text ?? 'body' },
      { type: 'section-end', section: 'document', count: 1 },
    );
  }
  if (versions.history !== undefined) {
    const reasons = content.reasons ?? ['made'];
    out.push({ type: 'section-start', section: 'history' });
    reasons.forEach((reason, i) => {
      out.push({ type: 'history-item', at: `2026-01-01T00:00:0${i}Z`, reason });
    });
    out.push(
      { type: 'section-end', section: 'history', count: reasons.length },
      { type: 'complete', versions },
    );
    return out;
  }
  out.push({ type: 'complete', versions });
  return out;
}

export function summaryOf(
  tasks: Array<{ id: number; document: string; history: string }>,
  version = 'sv1',
  projectId = P,
  epics: Array<{ id: string; document: string }> = [],
): Summary {
  return {
    project: { id: projectId, name: projectId },
    version,
    tasks: tasks.map((t) => ({
      id: t.id,
      title: `t${t.id}`,
      taskStatus: 'todo',
      agentStatus: 'idle',
      assignee: 'ai',
      isDraft: false,
      position: 0,
      epicId: null,
      acceptance: { done: 0, total: 0 },
      updatedAt: '2026-01-01T00:00:00Z',
      pendingRequestId: null,
      pendingReason: null,
      pendingChoices: [],
      taskStatusChangedAt: '2026-01-01T00:00:00Z',
      agentStatusChangedAt: '2026-01-01T00:00:00Z',
      detailVersions: { document: t.document, history: t.history },
    })),
    epics: epics.map((e) => ({
      id: e.id,
      name: e.id,
      color: '#112233',
      isDraft: false,
      progress: { todo: 0, doing: 0, done: 0, archived: 0, total: 0 },
      detailVersions: { document: e.document },
    })),
    problems: [],
  };
}

/** Lets promise continuations run. */
export const flush = async (times = 20) => {
  for (let i = 0; i < times; i++) await Promise.resolve();
};

// ---- A fake adapter whose responses the test hands out one by one

import type { ChangedEvent as Changed, Facet } from '../api/contracts';
import type { DataAdapter, DetailRequest, EventHandlers } from './types';

export interface SummaryCall {
  projectId: string;
  signal: AbortSignal;
  resolve(summary: Summary): void;
  reject(error: Error): void;
}

export interface StreamCall {
  request: DetailRequest;
  signal: AbortSignal;
  push(...events: DetailEvent[]): void;
  end(): void;
  fail(error: Error): void;
  /** Pushes every event and ends the stream. */
  respond(events: DetailEvent[]): void;
  readonly ended: boolean;
}

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

export class FakeAdapter implements DataAdapter {
  summaryCalls: SummaryCall[] = [];
  streamCalls: StreamCall[] = [];
  handlers: EventHandlers | null = null;
  opened = 0;
  closed = 0;

  fetchSummary(projectId: string, signal: AbortSignal): Promise<Summary> {
    return new Promise((resolve, reject) => {
      this.summaryCalls.push({ projectId, signal, resolve, reject });
      signal.addEventListener('abort', () => reject(abortError()));
    });
  }

  streamDetail(request: DetailRequest, signal: AbortSignal): AsyncIterable<DetailEvent> {
    const queue: DetailEvent[] = [];
    let waiter: { res(r: IteratorResult<DetailEvent>): void; rej(e: Error): void } | null = null;
    let error: Error | null = null;
    let ended = false;
    const wake = () => {
      if (!waiter) return;
      const w = waiter;
      if (queue.length) {
        waiter = null;
        w.res({ value: queue.shift() as DetailEvent, done: false });
      } else if (error) {
        waiter = null;
        w.rej(error);
      } else if (ended) {
        waiter = null;
        w.res({ value: undefined, done: true });
      }
    };
    const call: StreamCall = {
      request,
      signal,
      push: (...events) => {
        queue.push(...events);
        wake();
      },
      end: () => {
        ended = true;
        wake();
      },
      fail: (e) => {
        error = e;
        wake();
      },
      respond: (events) => {
        call.push(...events);
        call.end();
      },
      get ended() {
        return ended;
      },
    };
    signal.addEventListener('abort', () => call.fail(abortError()));
    this.streamCalls.push(call);
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => {
          if (queue.length)
            return Promise.resolve({ value: queue.shift() as DetailEvent, done: false });
          if (error) return Promise.reject(error);
          if (ended) return Promise.resolve({ value: undefined, done: true as const });
          return new Promise((res, rej) => {
            waiter = { res, rej };
          });
        },
      }),
    };
  }

  openEvents(handlers: EventHandlers): () => void {
    this.handlers = handlers;
    this.opened++;
    return () => {
      this.closed++;
      if (this.handlers === handlers) this.handlers = null;
    };
  }
}

export const changed = (
  seq: number,
  changes: Array<{ resource: 'task' | 'epic' | 'project'; id: number | string; facets: Facet[] }>,
  projectId = P,
  instanceId = 'i1',
): Changed => ({ instanceId, seq, projectId, changes });
