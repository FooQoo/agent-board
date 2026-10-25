import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataCore } from './data-core';
import type { VisibilitySource } from './event-connection';
import { changed, doc, FakeAdapter, hist, P, summaryOf, task, taskStream } from './test-support';

let adapter: FakeAdapter;
let core: DataCore;
const visible: VisibilitySource = { hidden: () => false, subscribe: () => () => {} };
const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
const seed = (id: number) => {
  core.store.commit(task(id), 'document', doc('old'), 'd1');
  core.store.commit(task(id), 'history', hist('a'), 'h1');
};
const sv = (version = 'sv1', docs: Record<number, string> = { 1: 'd1' }) =>
  summaryOf(
    Object.entries(docs).map(([id, document]) => ({ id: Number(id), document, history: 'h1' })),
    version,
  );

beforeEach(() => {
  vi.useFakeTimers();
  adapter = new FakeAdapter();
  core = new DataCore({ adapter, visibility: visible });
});
afterEach(() => {
  core.dispose();
  vi.useRealTimers();
});

describe('subscribe first, then fetch', () => {
  it('does not fetch the Summary before the subscription is open', async () => {
    core.start();
    core.watchProject(P);
    await settle(1_000);
    expect(adapter.opened).toBe(1);
    expect(adapter.summaryCalls).toHaveLength(0);
    adapter.handlers?.onOpen?.();
    expect(adapter.summaryCalls).toHaveLength(1);
  });

  it('fetches at once for a screen that mounts after the connection is open', async () => {
    core.start();
    adapter.handlers?.onOpen?.();
    core.watchProject(P);
    expect(adapter.summaryCalls).toHaveLength(1);
    adapter.summaryCalls[0]?.resolve(sv());
    await settle(0);
    expect(core.store.getSummary(P).state).toBe('ready');
    core.watchProject(P);
    expect(adapter.summaryCalls).toHaveLength(1);
  });

  it('fetches without waiting when the connection could not open', async () => {
    core.start();
    core.watchProject(P);
    adapter.handlers?.onClose?.();
    expect(adapter.summaryCalls).toHaveLength(1);
  });

  it('records a notification that arrives during the first Summary fetch and checks it afterwards', async () => {
    core.start();
    core.watchProject(P);
    seed(1);
    adapter.handlers?.onOpen?.();
    adapter.handlers?.onChanged(changed(1, [{ resource: 'task', id: 1, facets: ['document'] }]));
    adapter.summaryCalls[0]?.resolve(sv('sv1', { 1: 'd1' })); // older than the notification
    await settle(0);
    expect(adapter.summaryCalls).toHaveLength(2);
    adapter.summaryCalls[1]?.resolve(sv('sv2', { 1: 'd2' }));
    await settle(0);
    expect(adapter.streamCalls.map((c) => c.request.sections)).toEqual([['document']]);
  });
});

describe('reconnecting', () => {
  it('fetches the Summary again after a reconnect and settles the cache with it', async () => {
    core.start();
    core.watchProject(P);
    seed(1);
    adapter.handlers?.onOpen?.();
    adapter.summaryCalls[0]?.resolve(sv());
    await settle(0);
    adapter.handlers?.onClose?.();
    await settle(1_000);
    expect(adapter.opened).toBe(2);
    adapter.handlers?.onOpen?.();
    expect(core.store.getSection(task(1), 'document').state).toBe('stale');
    await settle(150);
    expect(adapter.summaryCalls).toHaveLength(2);
    adapter.summaryCalls[1]?.resolve(sv('sv2', { 1: 'd5' }));
    await settle(150);
    expect(adapter.streamCalls.map((c) => c.request.sections)).toEqual([['document']]);
    expect(core.store.getSection(task(1), 'history').state).toBe('ready');
  });
});

describe('Details on screen', () => {
  it('pins and loads what is opened, and unpins when it is closed', async () => {
    core.start();
    adapter.handlers?.onOpen?.();
    const close = core.openDetail(task(1), ['document', 'history']);
    expect(core.store.getSection(task(1), 'document').pinned).toBe(true);
    expect(adapter.streamCalls).toHaveLength(1);
    adapter.streamCalls[0]?.respond(taskStream(1, { document: 'd1', history: 'h1' }));
    await settle(0);
    expect(core.store.getSection(task(1), 'document').state).toBe('ready');
    close();
    expect(core.store.getSection(task(1), 'document').pinned).toBe(false);
  });

  it('loads only the sections that are asked for and are not whole yet', async () => {
    core.store.commit(task(1), 'document', doc(), 'd1');
    core.openDetail(task(1), ['document', 'history']);
    expect(adapter.streamCalls.map((c) => c.request.sections)).toEqual([['history']]);
  });

  it('does not fetch a section that is whole', () => {
    seed(1);
    core.openDetail(task(1), ['document']);
    expect(adapter.streamCalls).toHaveLength(0);
  });

  it('marks what a project left behind stale, since its notifications are ignored', async () => {
    core.start();
    adapter.handlers?.onOpen?.();
    const unwatch = core.watchProject(P);
    adapter.summaryCalls[0]?.resolve(sv());
    await settle(0);
    seed(1);
    unwatch();
    expect(core.store.getSummary(P).state).toBe('stale');
    expect(core.store.getSection(task(1), 'document').state).toBe('stale');
    core.watchProject(P);
    adapter.summaryCalls[1]?.resolve(sv('sv1', { 1: 'd1' }));
    await settle(0);
    expect(core.store.getSection(task(1), 'document').state).toBe('ready');
    expect(adapter.streamCalls).toHaveLength(0);
  });
});

describe('the presentation hold', () => {
  it('keeps the connection and applies nothing while a drawer is open', async () => {
    core.start();
    adapter.handlers?.onOpen?.();
    core.watchProject(P);
    adapter.summaryCalls[0]?.resolve(sv());
    await settle(0);
    seed(1);
    const release = core.gate.acquire('drawer');
    adapter.handlers?.onChanged(changed(1, [{ resource: 'task', id: 1, facets: ['document'] }]));
    await settle(20_000);
    expect(adapter.closed).toBe(0);
    expect(adapter.streamCalls).toHaveLength(0);
    release();
    await settle(3_150);
    expect(adapter.streamCalls.map((c) => c.request.sections)).toEqual([['document']]);
  });

  it('lets a manual refresh through while held', async () => {
    core.start();
    adapter.handlers?.onOpen?.();
    core.gate.acquire('drawer');
    const done = core.refreshSummary(P);
    expect(adapter.summaryCalls).toHaveLength(1);
    adapter.summaryCalls[0]?.resolve(sv());
    await done;
    expect(core.store.getSummary(P).state).toBe('ready');
  });
});

describe('the app is told', () => {
  it('passes the build ID, preferences and connection state on', () => {
    const ready = vi.fn();
    const preferences = vi.fn();
    const state = vi.fn();
    core.dispose();
    core = new DataCore({
      adapter,
      visibility: visible,
      onReady: ready,
      onPreferences: preferences,
      onConnectionState: state,
    });
    core.start();
    adapter.handlers?.onReady?.('b1');
    adapter.handlers?.onPreferences?.({ a: 1 });
    adapter.handlers?.onOpen?.();
    expect(ready).toHaveBeenCalledWith('b1');
    expect(preferences).toHaveBeenCalledWith({ a: 1 });
    expect(state).toHaveBeenLastCalledWith('connected');
  });

  it('closes the connection on dispose', () => {
    core.start();
    core.dispose();
    expect(adapter.closed).toBe(1);
  });
});
