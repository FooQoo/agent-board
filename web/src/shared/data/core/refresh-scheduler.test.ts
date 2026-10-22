import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangeInvalidator } from './change-invalidator';
import { PresentationGate } from './presentation-gate';
import { RefreshScheduler } from './refresh-scheduler';
import { ResourceStore } from './resource-store';
import {
  changed,
  doc,
  FakeAdapter,
  flush,
  hist,
  P,
  summaryOf,
  task,
  taskStream,
} from './test-support';
import type { ResourceKey } from './types';

let adapter: FakeAdapter;
let store: ResourceStore;
let gate: PresentationGate;
let scheduler: RefreshScheduler;
let seq = 0;

beforeEach(() => {
  vi.useFakeTimers();
  seq = 0;
  adapter = new FakeAdapter();
  store = new ResourceStore();
  gate = new PresentationGate();
  const watched = new Set([P]);
  const invalidator = new ChangeInvalidator(store, { isActiveProject: (id) => watched.has(id) });
  scheduler = new RefreshScheduler({
    adapter,
    store,
    gate,
    invalidator,
    watchedProjects: () => watched,
  });
});
afterEach(() => {
  scheduler.dispose();
  vi.useRealTimers();
});

const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
const seed = (id: number, document = 'd1', history = 'h1', text = 'old') => {
  store.commit(task(id), 'document', doc(text), document);
  store.commit(task(id), 'history', hist('a'), history);
};
const note = (id: number, ...facets: Array<'summary' | 'document' | 'history' | 'deleted'>) =>
  scheduler.onChanged(changed(++seq, [{ resource: 'task', id, facets }]));
const sectionsOf = (i: number) => adapter.streamCalls[i]?.request.sections;
const keyOf = (i: number): ResourceKey | undefined => adapter.streamCalls[i]?.request.resource;

describe('single-flight', () => {
  it('joins concurrent requests for the Summary of one project', async () => {
    const a = scheduler.loadSummary(P);
    const b = scheduler.loadSummary(P);
    expect(adapter.summaryCalls).toHaveLength(1);
    adapter.summaryCalls[0]?.resolve(summaryOf([]));
    await Promise.all([a, b]);
    expect(store.getSummary(P).state).toBe('ready');
    expect(adapter.summaryCalls).toHaveLength(1);
  });

  it('joins concurrent requests for one resource, also a request for a section it already streams', async () => {
    const a = scheduler.loadDetail(task(1), ['document', 'history']);
    const b = scheduler.loadDetail(task(1), ['document', 'history']);
    const c = scheduler.loadDetail(task(1), ['history']);
    expect(adapter.streamCalls).toHaveLength(1);
    adapter.streamCalls[0]?.respond(taskStream(1, { document: 'd1', history: 'h1' }));
    await Promise.all([a, b, c]);
    expect(store.getSection(task(1), 'document')).toMatchObject({ state: 'ready', version: 'd1' });
    expect(store.getSection(task(1), 'history')).toMatchObject({ state: 'ready', version: 'h1' });
    expect(adapter.streamCalls).toHaveLength(1);
  });

  it('merges notifications for one section into one fetch', async () => {
    seed(1);
    note(1, 'document');
    note(1, 'document');
    note(1, 'document', 'summary');
    await settle(150);
    const streams = adapter.streamCalls.filter((c) => c.request.sections.join() === 'document');
    expect(streams).toHaveLength(1);
  });
});

describe('partial data', () => {
  it('shows what arrived as partial and keeps data empty until complete', async () => {
    const stream = taskStream(1, { document: 'd1' }, { text: 'hello' });
    const done = scheduler.loadDetail(task(1), ['document']);
    const call = adapter.streamCalls[0];
    call?.push(...stream.slice(0, 3));
    await flush();
    const during = store.getSection(task(1), 'document');
    expect(during.state).toBe('loading');
    expect(during.partial?.blocks[0]?.text).toBe('hello');
    expect(during.data).toBeNull();
    call?.push(...stream.slice(3));
    call?.end();
    await done;
    const after = store.getSection(task(1), 'document');
    expect(after).toMatchObject({ state: 'ready', partial: null, version: 'd1' });
    expect(after.data?.blocks[0]?.text).toBe('hello');
  });

  it('keeps the whole version when the stream is cut', async () => {
    seed(1, 'd1', 'h1', 'old');
    const done = scheduler.loadDetail(task(1), ['document']);
    const call = adapter.streamCalls[0];
    call?.push(...taskStream(1, { document: 'd2' }, { text: 'new' }).slice(0, 3));
    await flush();
    expect(store.getSection(task(1), 'document').state).toBe('refreshing');
    call?.fail(new Error('connection lost'));
    await done;
    const s = store.getSection(task(1), 'document');
    expect(s.data?.blocks[0]?.text).toBe('old');
    expect(s.version).toBe('d1');
    expect(s.partial).toBeNull();
    expect(s.state).toBe('stale');
  });

  it('does not keep a stream that ends without complete, or whose counts are wrong', async () => {
    seed(1, 'd1', 'h1', 'old');
    const cut = scheduler.loadDetail(task(1), ['document']);
    adapter.streamCalls[0]?.respond(taskStream(1, { document: 'd2' }).slice(0, -1));
    await cut;
    expect(store.getSection(task(1), 'document').version).toBe('d1');
    const bad = scheduler.loadDetail(task(1), ['document']);
    adapter.streamCalls[1]?.respond(
      taskStream(1, { document: 'd2' }).map((e) =>
        e.type === 'section-end' ? { ...e, count: 9 } : e,
      ),
    );
    await bad;
    expect(store.getSection(task(1), 'document').version).toBe('d1');
    expect(store.getSection(task(1), 'document').error).not.toBeNull();
  });
});

describe('notifications', () => {
  it('fetches nothing for a resource that is not cached', async () => {
    note(99, 'summary', 'document', 'history');
    await settle(5_000);
    expect(adapter.streamCalls).toHaveLength(0);
    expect(adapter.summaryCalls).toHaveLength(1); // only the summary facet asks for a Summary
  });

  it('fetches nothing at all for a document change of an uncached resource', async () => {
    note(99, 'document');
    await settle(5_000);
    expect(adapter.streamCalls).toHaveLength(0);
    expect(adapter.summaryCalls).toHaveLength(0);
  });

  it('fetches only the history for a history change, and only the document for a document change', async () => {
    seed(1);
    note(1, 'history');
    await settle(150);
    expect(adapter.streamCalls.map((c) => c.request.sections)).toEqual([['history']]);
    adapter.streamCalls[0]?.respond(taskStream(1, { history: 'h2' }, { reasons: ['a', 'b'] }));
    await settle(0);
    expect(store.getSection(task(1), 'document').version).toBe('d1');
    expect(store.getSection(task(1), 'history').version).toBe('h2');

    note(1, 'document');
    await settle(150);
    expect(adapter.streamCalls.map((c) => c.request.sections)).toEqual([['history'], ['document']]);
  });

  it('waits for the window before it fetches', async () => {
    seed(1);
    note(1, 'document');
    await settle(149);
    expect(adapter.streamCalls).toHaveLength(0);
    await settle(1);
    expect(adapter.streamCalls).toHaveLength(1);
  });

  it('runs two background fetches at once, the rest as they finish', async () => {
    for (const id of [1, 2, 3]) seed(id);
    scheduler.onChanged(
      changed(
        ++seq,
        [1, 2, 3].map((id) => ({ resource: 'task' as const, id, facets: ['document' as const] })),
      ),
    );
    await settle(150);
    expect(adapter.streamCalls).toHaveLength(2);
    adapter.streamCalls[0]?.respond(taskStream(1, { document: 'd2' }));
    await settle(0);
    expect(adapter.streamCalls).toHaveLength(3);
  });

  it('starts the resources that are on screen first', async () => {
    for (const id of [1, 2, 3, 4]) seed(id);
    store.pin(task(4));
    scheduler.onChanged(
      changed(
        ++seq,
        [1, 2, 3, 4].map((id) => ({
          resource: 'task' as const,
          id,
          facets: ['document' as const],
        })),
      ),
    );
    await settle(150);
    expect(adapter.streamCalls.map((_, i) => keyOf(i)?.id)).toEqual([4, 1]);
  });

  it('drops a deleted resource and asks for the Summary', async () => {
    seed(1);
    note(1, 'deleted');
    await settle(150);
    expect(store.getSection(task(1), 'document').state).toBe('absent');
    expect(adapter.summaryCalls).toHaveLength(1);
    expect(adapter.streamCalls).toHaveLength(0);
  });
});

describe('Summary against the cache', () => {
  it('fetches again only the sections whose version differs', async () => {
    seed(1);
    seed(2);
    seed(3);
    const done = scheduler.loadSummary(P);
    adapter.summaryCalls[0]?.resolve(
      summaryOf([
        { id: 1, document: 'd2', history: 'h1' },
        { id: 2, document: 'd1', history: 'h1' },
        { id: 3, document: 'd1', history: 'h9' },
      ]),
    );
    await done;
    await settle(150);
    const asked = adapter.streamCalls.map((c) => `${c.request.resource.id}:${c.request.sections}`);
    expect(asked.sort()).toEqual(['1:document', '3:history']);
    expect(store.getSection(task(2), 'document').state).toBe('ready');
    expect(store.getSection(task(1), 'history').state).toBe('ready');
  });

  it('takes a section back to ready when its version matches after a reset', async () => {
    seed(1);
    store.markAllStale();
    const done = scheduler.loadSummary(P);
    adapter.summaryCalls[0]?.resolve(summaryOf([{ id: 1, document: 'd1', history: 'h1' }]));
    await done;
    await settle(1_000);
    expect(adapter.streamCalls).toHaveLength(0);
    expect(store.getSection(task(1), 'document').state).toBe('ready');
    expect(store.getSection(task(1), 'history').state).toBe('ready');
  });

  it('drops cached Details the Summary no longer lists', async () => {
    seed(1);
    seed(3);
    const done = scheduler.loadSummary(P);
    adapter.summaryCalls[0]?.resolve(summaryOf([{ id: 1, document: 'd1', history: 'h1' }]));
    await done;
    expect(store.getSection(task(3), 'document').state).toBe('absent');
    expect(store.getSection(task(1), 'document').state).toBe('ready');
  });

  it('compares epics by their document version', async () => {
    store.commit({ kind: 'epic', projectId: P, id: 'E' }, 'document', doc(), 'e1');
    const done = scheduler.loadSummary(P);
    adapter.summaryCalls[0]?.resolve(summaryOf([], 'sv', P, [{ id: 'E', document: 'e2' }]));
    await done;
    await settle(150);
    expect(keyOf(0)).toEqual({ kind: 'epic', projectId: P, id: 'E' });
    expect(sectionsOf(0)).toEqual(['document']);
  });
});

describe('a notification during a fetch', () => {
  it('does not commit the response of a Detail stream that a newer notification outdated', async () => {
    seed(1, 'd1', 'h1', 'old');
    note(1, 'document');
    await settle(150);
    const first = adapter.streamCalls[0];
    first?.push(...taskStream(1, { document: 'd2' }, { text: 'v2' }).slice(0, 3));
    await flush();
    note(1, 'document');
    expect(first?.signal.aborted).toBe(true);
    first?.respond(taskStream(1, { document: 'd2' }, { text: 'v2' }));
    await settle(0);
    expect(store.getSection(task(1), 'document').data?.blocks[0]?.text).toBe('old');
    expect(adapter.streamCalls).toHaveLength(1);
    await settle(150);
    expect(adapter.streamCalls).toHaveLength(2);
    adapter.streamCalls[1]?.respond(taskStream(1, { document: 'd3' }, { text: 'v3' }));
    await settle(0);
    const s = store.getSection(task(1), 'document');
    expect(s).toMatchObject({ state: 'ready', version: 'd3' });
    expect(s.data?.blocks[0]?.text).toBe('v3');
  });

  it('fetches the Summary again when a notification says more than the response does', async () => {
    seed(1);
    store.commitSummary(P, summaryOf([{ id: 1, document: 'd1', history: 'h1' }], 'sv1'));
    const done = scheduler.loadSummary(P);
    note(1, 'document');
    adapter.summaryCalls[0]?.resolve(summaryOf([{ id: 1, document: 'd1', history: 'h1' }], 'sv1'));
    await settle(0);
    expect(adapter.summaryCalls).toHaveLength(2);
    expect(store.getSummary(P).state).toBe('refreshing');
    adapter.summaryCalls[1]?.resolve(summaryOf([{ id: 1, document: 'd2', history: 'h1' }], 'sv2'));
    await done;
    await settle(500);
    expect(adapter.streamCalls.map((c) => c.request.sections)).toEqual([['document']]);
    expect(store.getSummary(P).version).toBe('sv2');
  });

  it('accepts a response that already shows the change', async () => {
    seed(1);
    store.commitSummary(P, summaryOf([{ id: 1, document: 'd1', history: 'h1' }], 'sv1'));
    const done = scheduler.loadSummary(P);
    note(1, 'document');
    adapter.summaryCalls[0]?.resolve(summaryOf([{ id: 1, document: 'd2', history: 'h1' }], 'sv2'));
    await done;
    await settle(500);
    expect(adapter.summaryCalls).toHaveLength(1);
    expect(adapter.streamCalls.map((c) => c.request.sections)).toEqual([['document']]);
  });

  it('fetches again when a deleted resource is still in the response', async () => {
    seed(1);
    const done = scheduler.loadSummary(P);
    note(1, 'deleted');
    adapter.summaryCalls[0]?.resolve(summaryOf([{ id: 1, document: 'd1', history: 'h1' }]));
    await settle(0);
    expect(adapter.summaryCalls).toHaveLength(2);
    adapter.summaryCalls[1]?.resolve(summaryOf([]));
    await done;
  });

  it('stops asking again after a few contradictions and keeps the last response', async () => {
    store.commitSummary(P, summaryOf([], 'sv1'));
    const done = scheduler.loadSummary(P);
    for (let i = 0; i < 5; i++) {
      scheduler.onChanged(changed(++seq, [{ resource: 'project', id: P, facets: ['summary'] }]));
      adapter.summaryCalls[i]?.resolve(summaryOf([], 'sv1'));
      await settle(0);
    }
    await done;
    expect(adapter.summaryCalls.length).toBeLessThanOrEqual(3);
    expect(store.getSummary(P).state).toBe('ready');
  });
});

describe('the version a stream must have', () => {
  it('discards a stream whose version is not the one the Summary named and tries again after a new Summary', async () => {
    store.commitSummary(P, summaryOf([{ id: 5, document: 'd1', history: 'h1' }]));
    const done = scheduler.loadDetail(task(5), ['document']);
    adapter.streamCalls[0]?.respond(taskStream(5, { document: 'd9' }, { text: 'newer' }));
    await settle(0);
    expect(store.getSection(task(5), 'document').data).toBeNull();
    expect(adapter.summaryCalls).toHaveLength(1);
    adapter.summaryCalls[0]?.resolve(summaryOf([{ id: 5, document: 'd9', history: 'h1' }]));
    await settle(0);
    expect(adapter.streamCalls).toHaveLength(2);
    adapter.streamCalls[1]?.respond(taskStream(5, { document: 'd9' }, { text: 'newer' }));
    await done;
    expect(store.getSection(task(5), 'document')).toMatchObject({ state: 'ready', version: 'd9' });
  });

  it('does not hold a section to the Summary version once a notification said it changed', async () => {
    seed(1);
    store.commitSummary(P, summaryOf([{ id: 1, document: 'd1', history: 'h1' }]));
    note(1, 'document');
    await settle(150);
    adapter.streamCalls[0]?.respond(taskStream(1, { document: 'd2' }, { text: 'new' }));
    await settle(0);
    expect(store.getSection(task(1), 'document')).toMatchObject({ state: 'ready', version: 'd2' });
    expect(adapter.summaryCalls).toHaveLength(0);
  });
});

describe('cannot be trusted', () => {
  it('after a missing sequence number marks everything stale and settles it with one Summary', async () => {
    seed(1);
    seed(2);
    store.commitSummary(P, summaryOf([], 'sv1'));
    scheduler.onChanged(changed(1, [], 'other'));
    scheduler.onChanged(changed(3, [], 'other'));
    expect(store.getSection(task(1), 'document').state).toBe('stale');
    expect(store.getSummary(P).state).toBe('stale');
    await settle(150);
    expect(adapter.summaryCalls).toHaveLength(1);
    adapter.summaryCalls[0]?.resolve(
      summaryOf(
        [
          { id: 1, document: 'd1', history: 'h1' },
          { id: 2, document: 'd5', history: 'h1' },
        ],
        'sv2',
      ),
    );
    await settle(150);
    expect(
      adapter.streamCalls.map((c) => `${c.request.resource.id}:${c.request.sections}`),
    ).toEqual(['2:document']);
    expect(store.getSection(task(1), 'document').state).toBe('ready');
  });

  it('asks for the Summary again after a reconnect', async () => {
    seed(1);
    scheduler.connected(false);
    expect(adapter.summaryCalls).toHaveLength(1);
    adapter.summaryCalls[0]?.resolve(summaryOf([{ id: 1, document: 'd1', history: 'h1' }]));
    await settle(0);
    scheduler.connected(true);
    await settle(150);
    expect(store.getSection(task(1), 'document').state).toBe('stale');
    expect(adapter.summaryCalls).toHaveLength(2);
  });
});

describe('the presentation gate', () => {
  it('fetches nothing while held, and applies the changes 3 seconds after the release', async () => {
    seed(1);
    const release = gate.acquire('drawer');
    note(1, 'document');
    await settle(10_000);
    expect(adapter.streamCalls).toHaveLength(0);
    expect(store.getSection(task(1), 'document').state).toBe('ready');
    release();
    await settle(2_999);
    expect(adapter.streamCalls).toHaveLength(0);
    await settle(1);
    expect(store.getSection(task(1), 'document').state).toBe('stale');
    await settle(150);
    expect(adapter.streamCalls).toHaveLength(1);
  });

  it('drops the wait when something is held again', async () => {
    seed(1);
    const first = gate.acquire('drawer');
    note(1, 'document');
    first();
    await settle(2_000);
    const second = gate.acquire('modal');
    await settle(10_000);
    expect(adapter.streamCalls).toHaveLength(0);
    second();
    await settle(3_000 + 150);
    expect(adapter.streamCalls).toHaveLength(1);
  });

  it('stops a background fetch that is running when something is opened and does it again afterwards', async () => {
    seed(1);
    note(1, 'document');
    await settle(150);
    const first = adapter.streamCalls[0];
    expect(first).toBeDefined();
    const release = gate.acquire('drawer');
    expect(first?.signal.aborted).toBe(true);
    await settle(10_000);
    expect(adapter.streamCalls).toHaveLength(1);
    expect(store.getSection(task(1), 'document').data?.blocks[0]?.text).toBe('old');
    release();
    await settle(3_000 + 150);
    expect(adapter.streamCalls).toHaveLength(2);
    adapter.streamCalls[1]?.respond(taskStream(1, { document: 'd2' }, { text: 'new' }));
    await settle(0);
    expect(store.getSection(task(1), 'document').data?.blocks[0]?.text).toBe('new');
  });

  it('does not hold back what the person asked for: opening, a manual refresh', async () => {
    gate.acquire('drawer');
    const open = scheduler.loadDetail(task(7), ['document']);
    expect(adapter.streamCalls).toHaveLength(1);
    adapter.streamCalls[0]?.respond(taskStream(7, { document: 'd1' }));
    await open;
    expect(store.getSection(task(7), 'document').state).toBe('ready');
    const refresh = scheduler.loadSummary(P, { immediate: true });
    expect(adapter.summaryCalls).toHaveLength(1);
    adapter.summaryCalls[0]?.resolve(summaryOf([{ id: 7, document: 'd5', history: 'h1' }]));
    await refresh;
    expect(adapter.streamCalls).toHaveLength(2); // the manual refresh reaches the Details too
  });

  it('keeps the connection notifications coming: the sequence is checked while held', async () => {
    seed(1);
    gate.acquire('drawer');
    scheduler.onChanged(changed(1, [], 'other'));
    scheduler.onChanged(changed(5, [], 'other'));
    await settle(10_000);
    expect(adapter.summaryCalls).toHaveLength(0);
  });
});

describe('failure and teardown', () => {
  it('records an error for a failed first load and resolves the waiter', async () => {
    const done = scheduler.loadDetail(task(1), ['history']);
    adapter.streamCalls[0]?.fail(new Error('boom'));
    await done;
    expect(store.getSection(task(1), 'history')).toMatchObject({ state: 'error' });
  });

  it('aborts every fetch on dispose', async () => {
    void scheduler.loadSummary(P);
    void scheduler.loadDetail(task(1), ['document']);
    scheduler.dispose();
    expect(adapter.summaryCalls[0]?.signal.aborted).toBe(true);
    expect(adapter.streamCalls[0]?.signal.aborted).toBe(true);
    await settle(1_000);
    expect(adapter.summaryCalls).toHaveLength(1);
  });
});
