import { beforeEach, describe, expect, it } from 'vitest';
import type { Change, ChangedEvent } from '../api/contracts';
import { ChangeInvalidator } from './change-invalidator';
import { ResourceStore } from './resource-store';
import { doc, epic, hist, P, summaryOf, task } from './test-support';

let store: ResourceStore;
let invalidator: ChangeInvalidator;

const event = (changes: Change[], seq = 1, projectId = P, instanceId = 'i1'): ChangedEvent => ({
  instanceId,
  seq,
  projectId,
  changes,
});
const change = (resource: Change['resource'], id: number | string, ...facets: Change['facets']) =>
  ({ resource, id, facets }) as Change;
const state = (key = task(1), section: 'document' | 'history' = 'document') =>
  store.getSection(key, section).state;

beforeEach(() => {
  store = new ResourceStore();
  invalidator = new ChangeInvalidator(store, { isActiveProject: (id) => id === P });
  store.commit(task(1), 'document', doc(), 'd1');
  store.commit(task(1), 'history', hist('a'), 'h1');
  store.commit(epic('E'), 'document', doc(), 'e1');
  store.commitSummary(P, summaryOf([]));
});

describe('which sections go stale', () => {
  it('marks only the history of a cached task for a history change', () => {
    const result = invalidator.handle(event([change('task', 1, 'history')]));
    expect(result.reset).toBeNull();
    expect(state(task(1), 'history')).toBe('stale');
    expect(state(task(1), 'document')).toBe('ready');
    expect(result.stale).toEqual([{ key: task(1), section: 'history' }]);
    expect(result.summary).toBe(false);
  });

  it('marks only the document for a document change', () => {
    const result = invalidator.handle(event([change('task', 1, 'document')]));
    expect(state(task(1), 'document')).toBe('stale');
    expect(state(task(1), 'history')).toBe('ready');
    expect(result.stale).toEqual([{ key: task(1), section: 'document' }]);
  });

  it('marks the document of a cached epic, apart from a task with the same text', () => {
    const result = invalidator.handle(event([change('epic', 'E', 'document')]));
    expect(state(epic('E'))).toBe('stale');
    expect(state(task(1))).toBe('ready');
    expect(result.stale).toEqual([{ key: epic('E'), section: 'document' }]);
  });

  it('does nothing for a resource that is not cached', () => {
    const result = invalidator.handle(
      event([change('task', 9, 'summary', 'document', 'history'), change('epic', 'Z', 'document')]),
    );
    expect(result.stale).toEqual([]);
    expect(store.cachedKeys()).toHaveLength(2);
    expect(store.getSection(task(9), 'document').state).toBe('absent');
  });

  it('asks for a new Summary on the summary facet and leaves cached Details alone', () => {
    const result = invalidator.handle(event([change('task', 1, 'summary')]));
    expect(result.summary).toBe(true);
    expect(result.stale).toEqual([]);
    expect(state(task(1))).toBe('ready');
  });

  it('asks for a new Summary for a project change', () => {
    expect(invalidator.handle(event([change('project', P, 'summary')])).summary).toBe(true);
  });

  it('reports a section that is refreshing, so the fetch in flight can be replaced', () => {
    store.begin(task(1), ['history']);
    const result = invalidator.handle(event([change('task', 1, 'history')]));
    expect(result.stale).toEqual([{ key: task(1), section: 'history' }]);
  });

  it('drops a deleted resource and asks for a new Summary', () => {
    const result = invalidator.handle(event([change('task', 1, 'deleted')]));
    expect(state(task(1))).toBe('absent');
    expect(result.removed).toEqual([task(1)]);
    expect(result.summary).toBe(true);
    expect(result.stale).toEqual([]);
  });

  it('applies every change of one event', () => {
    const result = invalidator.handle(
      event([change('task', 1, 'history'), change('epic', 'E', 'document')]),
    );
    expect(result.stale).toHaveLength(2);
  });

  it('ignores another project', () => {
    const result = invalidator.handle(event([change('task', 1, 'document')], 1, 'other'));
    expect(result).toEqual({ reset: null, summary: false, stale: [], removed: [] });
    expect(state()).toBe('ready');
  });
});

describe('when the cache cannot be trusted', () => {
  it('accepts the first event and the next sequence number', () => {
    expect(invalidator.handle(event([], 7)).reset).toBeNull();
    expect(invalidator.handle(event([], 8)).reset).toBeNull();
    expect(state()).toBe('ready');
  });

  it('resets on a missing sequence number and marks the Summary and every Detail stale', () => {
    invalidator.handle(event([], 7));
    const result = invalidator.handle(event([], 9));
    expect(result.reset).toBe('seq-gap');
    expect(result.summary).toBe(true);
    expect(state(task(1), 'document')).toBe('stale');
    expect(state(task(1), 'history')).toBe('stale');
    expect(state(epic('E'))).toBe('stale');
    expect(store.getSummary(P).state).toBe('stale');
  });

  it('resets when the sequence goes back or repeats', () => {
    invalidator.handle(event([], 7));
    expect(invalidator.handle(event([], 7)).reset).toBe('seq-gap');
  });

  it('resets when the server instance changes, and counts from the new one afterwards', () => {
    invalidator.handle(event([], 7));
    expect(invalidator.handle(event([], 1, P, 'i2')).reset).toBe('instance-changed');
    expect(invalidator.handle(event([], 2, P, 'i2')).reset).toBeNull();
  });

  it('checks the sequence on events of other projects too', () => {
    invalidator.handle(event([], 7, 'other'));
    expect(invalidator.handle(event([], 9, 'other')).reset).toBe('seq-gap');
    expect(state()).toBe('stale');
  });

  it('resets on a resource or a facet it does not know', () => {
    const unknownResource = { resource: 'sprint', id: 1, facets: ['summary'] } as unknown as Change;
    expect(invalidator.handle(event([unknownResource], 1)).reset).toBe('unknown-event');
    store.commit(task(1), 'document', doc(), 'd1');
    const unknownFacet = { resource: 'task', id: 1, facets: ['comments'] } as unknown as Change;
    expect(invalidator.handle(event([unknownFacet], 2)).reset).toBe('unknown-event');
    expect(state()).toBe('stale');
  });

  it('forgets the sequence so a reconnect does not look like a gap', () => {
    invalidator.handle(event([], 7));
    invalidator.forgetSequence();
    expect(invalidator.handle(event([], 20)).reset).toBeNull();
  });

  it('reset() marks everything stale for a reason the connection found', () => {
    invalidator.reset('reconnected');
    expect(state()).toBe('stale');
    expect(store.getSummary(P).state).toBe('stale');
  });
});

describe('observe and apply apart', () => {
  it('checks the sequence on receipt and changes nothing until apply', () => {
    expect(invalidator.observe(event([change('task', 1, 'document')], 1))).toBeNull();
    expect(state()).toBe('ready');
    invalidator.apply(event([change('task', 1, 'document')], 1));
    expect(state()).toBe('stale');
  });
});
