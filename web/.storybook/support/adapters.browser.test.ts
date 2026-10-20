import { describe, expect, it } from 'vitest';
import { unconnectedMonitorReadResolvers } from '../../src/pages/monitor/contracts';
import type { Epic } from '../../src/shared/api/contracts';
import {
  createCallLog,
  createDeferred,
  createFakeAnswerWriter,
  createFakeEpicApi,
  createFakeMonitorReadResolvers,
  epicRefOf,
} from './adapters';
import { makeEpic, makeMonitorTask, makeProject, makeTask } from './fixtures';

const PROJECT = makeProject();
const EPIC: Epic = makeEpic();

describe('deferred promises', () => {
  it('stay pending until the Story settles them, then carry the value or the failure', async () => {
    const ok = createDeferred<string>();
    let settled = false;
    void ok.promise.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    ok.resolve('saved');
    await expect(ok.promise).resolves.toBe('saved');

    const failed = createDeferred<string>();
    failed.reject(new Error('network down'));
    await expect(failed.promise).rejects.toThrow('network down');
  });
});

describe('call log', () => {
  it('keeps the arguments as they were when the call was made', () => {
    const log = createCallLog<[{ name: string }]>();
    const input = { name: 'before' };
    log.record(input);
    input.name = 'after';
    expect(log.calls).toEqual([[{ name: 'before' }]]);
  });
});

describe('epic API fake (EpicDialog contract)', () => {
  it('records each write in order with its arguments, and answers with the given outcome', async () => {
    const { api, calls } = createFakeEpicApi(async () => undefined);
    await api.saveDetails({ name: 'Renamed', color: '#ff0000', isDraft: false });
    await api.savePlan({ plan: '# Plan' });
    await api.savePriority([3, 1, 2]);
    expect(calls.calls.map(([method]) => method)).toEqual([
      'saveDetails',
      'savePlan',
      'savePriority',
    ]);
    expect(calls.calls[0]).toEqual([
      'saveDetails',
      { name: 'Renamed', color: '#ff0000', isDraft: false },
    ]);
    expect(calls.calls[2]).toEqual(['savePriority', [3, 1, 2]]);
  });

  it('models a staged save whose second stage fails, and still records the failed call', async () => {
    const { api, calls } = createFakeEpicApi(async (method) => {
      if (method === 'saveDetails') throw new Error('stage 2 failed');
    });
    await api.savePlan({ body: 'Body' });
    await expect(
      api.saveDetails({ name: 'Retry me', color: '#00ff00', isDraft: true }),
    ).rejects.toThrow('stage 2 failed');
    expect(calls.calls.map(([method]) => method)).toEqual(['savePlan', 'saveDetails']);
  });

  it('keeps a call pending until the Story resolves it, and records a retry as a second call', async () => {
    const gate = createDeferred<void>();
    let attempts = 0;
    const { api, calls } = createFakeEpicApi(() => {
      attempts += 1;
      return attempts === 1 ? gate.promise : Promise.resolve();
    });
    const first = api.addImages([], 'request-1');
    let done = false;
    void first.then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    gate.resolve();
    await first;
    await api.addImages([], 'request-1');
    expect(calls.calls.map(([, , requestId]) => requestId)).toEqual(['request-1', 'request-1']);
  });
});

describe('monitor read resolvers fake (MonitorView contract)', () => {
  it('builds the same URLs as the product, for the same IDs', () => {
    const { resolvers } = createFakeMonitorReadResolvers();
    const args = [PROJECT.id, 7, 'att/1'] as const;
    expect(resolvers.attachmentUrl(...args)).toBe(
      unconnectedMonitorReadResolvers.attachmentUrl(...args),
    );
    expect(resolvers.epicAttachmentUrl(PROJECT.id, EPIC.id, 'img')).toBe(
      `/monitor/api/projects/${PROJECT.id}/epics/${EPIC.id}/attachments/img`,
    );
  });

  it('answers getEpics from the stored epics of the project, as copies', async () => {
    const { resolvers, epicRequests } = createFakeMonitorReadResolvers({ [PROJECT.id]: [EPIC] });
    const first = await resolvers.getEpics(PROJECT.id);
    expect(first).toEqual([EPIC]);
    const [copy] = first;
    expect(copy).toBeDefined();
    if (copy) copy.name = 'changed by the card';
    const second = await resolvers.getEpics(PROJECT.id);
    expect(second[0]?.name).toBe(EPIC.name);
    expect(epicRequests.calls).toEqual([[PROJECT.id], [PROJECT.id]]);
  });

  it('fails for a project with no stored epics, as the product fails when unconnected', async () => {
    const { resolvers } = createFakeMonitorReadResolvers({});
    await expect(resolvers.getEpics('f'.repeat(32))).rejects.toThrow('No epics are stored');
  });

  it('rejects with AbortError when the signal is already aborted', async () => {
    const { resolvers } = createFakeMonitorReadResolvers({ [PROJECT.id]: [EPIC] });
    const controller = new AbortController();
    controller.abort();
    await expect(resolvers.getEpics(PROJECT.id, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});

describe('copies of product values', () => {
  it('makeMonitorTask copies the task, so the monitor row cannot change the source', () => {
    const task = makeTask({ id: 9, title: 'Original' });
    const row = makeMonitorTask(task, PROJECT);
    expect(row).toEqual({ projectId: PROJECT.id, projectName: PROJECT.name, task });
    row.task.title = 'Changed in the row';
    expect(task.title).toBe('Original');
  });

  it('epicRefOf returns a new reference, so a card cannot change the epic', () => {
    const ref = epicRefOf(EPIC);
    expect(ref).toEqual({ id: EPIC.id, name: EPIC.name, color: EPIC.color });
    ref.name = 'changed';
    expect(EPIC.name).toBe('Sample epic');
  });
});

describe('answer writer fake (DecisionRequestForm contract)', () => {
  it('records the project, task and input of each write, and answers with the given result', async () => {
    const { writer, calls } = createFakeAnswerWriter(async () => ({ requestId: 'req-1' }) as never);
    const result = await writer(PROJECT.id, 4, { choiceId: 'a', body: 'Answer text' } as never);
    expect(result).toEqual({ requestId: 'req-1' });
    expect(calls.calls).toEqual([[PROJECT.id, 4, { choiceId: 'a', body: 'Answer text' }]]);
  });
});
