import { describe, expect, it, vi } from 'vitest';
import { ResourceStore } from './resource-store';
import { doc, epic, hist, P, summaryOf, task } from './test-support';

const small = {
  summaryProjects: 2,
  taskDetail: { count: 3, bytes: 1_000_000 },
  epicDetail: { count: 2, bytes: 1_000_000 },
};

describe('sections', () => {
  it('starts absent and returns the same snapshot until something changes', () => {
    const store = new ResourceStore();
    const a = store.getResource(task(1));
    expect(a.document.state).toBe('absent');
    expect(a.document.data).toBeNull();
    expect(store.getResource(task(1))).toBe(a);
    store.begin(task(1), ['document']);
    expect(store.getResource(task(1))).not.toBe(a);
    const b = store.getResource(task(1));
    expect(store.getResource(task(1))).toBe(b);
  });

  it('commit is the only way data becomes ready, with its version and size', () => {
    const store = new ResourceStore();
    store.begin(task(1), ['document']);
    expect(store.getSection(task(1), 'document').state).toBe('loading');
    store.setPartial(task(1), 'document', doc('half'));
    const loading = store.getSection(task(1), 'document');
    expect(loading.partial).toEqual(doc('half'));
    expect(loading.data).toBeNull();
    store.commit(task(1), 'document', doc('whole'), 'v1');
    const ready = store.getSection(task(1), 'document');
    expect(ready).toMatchObject({ state: 'ready', version: 'v1', partial: null, error: null });
    expect(ready.data).toEqual(doc('whole'));
    expect(ready.bytes).toBe(JSON.stringify(doc('whole')).length * 2);
  });

  it('keeps the whole version while a refresh streams and after it is discarded', () => {
    const store = new ResourceStore();
    store.commit(task(1), 'document', doc('old'), 'v1');
    store.begin(task(1), ['document']);
    store.setPartial(task(1), 'document', doc('new-half'));
    const during = store.getSection(task(1), 'document');
    expect(during.state).toBe('refreshing');
    expect(during.data).toEqual(doc('old'));
    store.discardPartial(task(1), ['document']);
    const after = store.getSection(task(1), 'document');
    expect(after.data).toEqual(doc('old'));
    expect(after.partial).toBeNull();
    expect(after.state).toBe('stale');
  });

  it('a failed first load is an error, a failed refresh keeps the data as stale', () => {
    const store = new ResourceStore();
    store.begin(task(1), ['history']);
    store.fail(task(1), ['history'], new Error('cut'));
    expect(store.getSection(task(1), 'history')).toMatchObject({ state: 'error', data: null });
    store.commit(task(2), 'history', hist('a'), 'h1');
    store.begin(task(2), ['history']);
    store.fail(task(2), ['history'], new Error('cut'));
    const s = store.getSection(task(2), 'history');
    expect(s.state).toBe('stale');
    expect(s.data).toEqual(hist('a'));
    expect(s.error?.message).toBe('cut');
  });

  it('marks only cached sections stale and can mark them fresh again', () => {
    const store = new ResourceStore();
    expect(store.markStale(task(1), 'document')).toBe(false);
    expect(store.getSection(task(1), 'document').state).toBe('absent');
    store.commit(task(1), 'document', doc(), 'v1');
    expect(store.markStale(task(1), 'document')).toBe(true);
    expect(store.getSection(task(1), 'document').state).toBe('stale');
    store.markFresh(task(1), 'document');
    expect(store.getSection(task(1), 'document').state).toBe('ready');
  });

  it('notifies subscribers of real changes only', () => {
    const store = new ResourceStore();
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.markStale(task(1), 'document');
    expect(listener).not.toHaveBeenCalled();
    store.commit(task(1), 'document', doc(), 'v1');
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    store.markStale(task(1), 'document');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('removes a resource and marks everything stale on request', () => {
    const store = new ResourceStore();
    store.commit(task(1), 'document', doc(), 'v1');
    store.commit(epic('E'), 'document', doc(), 'e1');
    store.commitSummary(P, summaryOf([]));
    store.markAllStale();
    expect(store.getSection(task(1), 'document').state).toBe('stale');
    expect(store.getSection(epic('E'), 'document').state).toBe('stale');
    expect(store.getSummary(P).state).toBe('stale');
    store.remove(task(1));
    expect(store.getSection(task(1), 'document').state).toBe('absent');
    expect(store.cachedKeys()).toEqual([epic('E')]);
  });
});

describe('summary', () => {
  it('commits a Summary and keeps it through a failed refresh', () => {
    const store = new ResourceStore();
    expect(store.getSummary(P).state).toBe('absent');
    store.beginSummary(P);
    expect(store.getSummary(P).state).toBe('loading');
    store.commitSummary(P, summaryOf([], 'sv1'));
    expect(store.getSummary(P)).toMatchObject({ state: 'ready', version: 'sv1' });
    store.beginSummary(P);
    expect(store.getSummary(P).state).toBe('refreshing');
    store.failSummary(P, new Error('x'));
    expect(store.getSummary(P)).toMatchObject({ state: 'stale' });
    expect(store.getSummary(P).data?.version).toBe('sv1');
  });

  it('drops a Summary fetch without an error: back to what was held before', () => {
    const store = new ResourceStore();
    store.beginSummary(P);
    store.discardSummary(P);
    expect(store.getSummary(P).state).toBe('absent');
    store.commitSummary(P, summaryOf([], 'sv1'));
    store.beginSummary(P);
    store.discardSummary(P);
    expect(store.getSummary(P)).toMatchObject({ state: 'stale', version: 'sv1' });
  });

  it('keeps the Summary of at most the limit of projects, least recently used out', () => {
    const store = new ResourceStore(small);
    store.commitSummary('a', summaryOf([], 'v', 'a'));
    store.commitSummary('b', summaryOf([], 'v', 'b'));
    store.touchSummary('a');
    store.commitSummary('c', summaryOf([], 'v', 'c'));
    expect(store.getSummary('b').state).toBe('absent');
    expect(store.getSummary('a').state).toBe('ready');
    expect(store.getSummary('c').state).toBe('ready');
  });
});

describe('limits', () => {
  it('drops the least recently used task Detail over the count', () => {
    const store = new ResourceStore(small);
    for (const id of [1, 2, 3]) store.commit(task(id), 'document', doc(), `v${id}`);
    store.touch(task(1));
    store.commit(task(4), 'document', doc(), 'v4');
    expect(store.getSection(task(2), 'document').state).toBe('absent');
    expect(store.getSection(task(1), 'document').state).toBe('ready');
    expect(store.cachedKeys()).toHaveLength(3);
  });

  it('counts epics apart from tasks', () => {
    const store = new ResourceStore(small);
    for (const id of [1, 2, 3]) store.commit(task(id), 'document', doc(), 'v');
    for (const id of ['A', 'B']) store.commit(epic(id), 'document', doc(), 'v');
    expect(store.cachedKeys()).toHaveLength(5);
    store.commit(epic('C'), 'document', doc(), 'v');
    expect(store.getSection(epic('A'), 'document').state).toBe('absent');
    expect(store.getSection(task(1), 'document').state).toBe('ready');
  });

  it('drops by size too, counting two bytes per character', () => {
    const big = 'x'.repeat(200);
    const bytes = JSON.stringify(doc(big)).length * 2;
    const store = new ResourceStore({ ...small, taskDetail: { count: 10, bytes: bytes * 2 } });
    store.commit(task(1), 'document', doc(big), 'v');
    store.commit(task(2), 'document', doc(big), 'v');
    store.commit(task(3), 'document', doc(big), 'v');
    expect(store.getSection(task(1), 'document').state).toBe('absent');
    expect(store.getSection(task(2), 'document').state).toBe('ready');
    expect(store.getSection(task(3), 'document').state).toBe('ready');
  });

  it('never drops a pinned resource, and drops it once unpinned and over the limit', () => {
    const store = new ResourceStore(small);
    const unpin = store.pin(task(1));
    for (const id of [1, 2, 3, 4, 5]) store.commit(task(id), 'document', doc(), 'v');
    expect(store.getSection(task(1), 'document')).toMatchObject({ state: 'ready', pinned: true });
    expect(store.getSection(task(2), 'document').state).toBe('absent');
    expect(store.getSection(task(3), 'document').state).toBe('absent');
    unpin();
    expect(store.getSection(task(1), 'document').pinned).toBe(false);
    expect(store.cachedKeys()).toHaveLength(3);
    store.commit(task(6), 'document', doc(), 'v');
    expect(store.getSection(task(1), 'document').state).toBe('absent');
    expect(store.cachedKeys()).toHaveLength(3);
  });

  it('allows going over the limit when every resource is pinned', () => {
    const store = new ResourceStore(small);
    for (const id of [1, 2, 3, 4]) {
      store.pin(task(id));
      store.commit(task(id), 'document', doc(), 'v');
    }
    expect(store.cachedKeys()).toHaveLength(4);
  });

  it('counts the pins of one resource', () => {
    const store = new ResourceStore();
    const a = store.pin(task(1));
    const b = store.pin(task(1));
    a();
    expect(store.getResource(task(1)).document.pinned).toBe(true);
    b();
    expect(store.getResource(task(1)).document.pinned).toBe(false);
  });
});
