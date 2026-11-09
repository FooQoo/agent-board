// @vitest-environment node
// Checking acceptance conditions, reordering a lane, and the automatic Done of the sample-data server.
import { describe, expect, it } from 'vitest';
import type { MockServer } from '../../src/app/development/mock-server/server';
import { boardOf, bodyOf, PROJECT, send, start, taskOf } from './mockServerCases';

const base = `/api/projects/${PROJECT}/tasks`;
const AT = '2026-11-09T00:00:00.000Z';

function check(
  server: MockServer,
  id: number,
  condition: string,
  done: unknown,
  language?: string,
) {
  return send(server, {
    method: 'PUT',
    url: `${base}/${id}/acceptance/${encodeURIComponent(condition)}`,
    headers: { 'x-agboard-token': 'mock-token', 'x-agboard-language': language },
    body: JSON.stringify({ done }),
  });
}

function reorder(server: MockServer, id: number, beforeId: unknown) {
  return send(server, {
    method: 'POST',
    url: `${base}/${id}/reorder`,
    body: JSON.stringify({ beforeId }),
  });
}

/** Lane order as the board shows it: by position, and from the highest position down in Done. */
function lane(server: MockServer, status: 'todo' | 'doing' | 'done'): number[] {
  const tasks = boardOf(server)
    .tasks.filter((task) => task.taskStatus === status && !task.archivedAt)
    .sort((a, b) => a.position - b.position || a.id - b.id);
  return (status === 'done' ? tasks.reverse() : tasks).map((task) => task.id);
}

describe('acceptance conditions', () => {
  it('checks and unchecks a condition, records it and reports the changed sections', () => {
    const { server, events } = start();
    const checked = check(server, 11, 'AC-3', true);
    expect(checked.status).toBe(200);
    const body = bodyOf<{
      task: { acceptance: Array<{ id: string; done: boolean }> };
      changed: boolean;
    }>(checked);
    expect(body.changed).toBe(true);
    expect(body.task.acceptance.find((item) => item.id === 'AC-3')?.done).toBe(true);
    expect(taskOf(server, 11).history.at(-1)).toEqual({
      at: AT,
      reason: 'A person marked AC-3 as met.',
    });
    expect(taskOf(server, 11).updatedAt).toBe(AT);
    check(server, 11, 'AC-3', false);
    expect(taskOf(server, 11).history.at(-1)?.reason).toBe('A person marked AC-3 as not met.');
    expect(events.map((event) => [event.seq, event.changes])).toEqual([
      [1, [{ resource: 'task', id: 11, facets: ['summary', 'document', 'history'] }]],
      [2, [{ resource: 'task', id: 11, facets: ['summary', 'document', 'history'] }]],
    ]);
  });

  it('writes the history in the language of the page, or of the task', () => {
    const { server } = start();
    check(server, 11, 'AC-3', true, 'ja');
    expect(taskOf(server, 11).history.at(-1)?.reason).toBe('ユーザーがAC-3を達成にしました。');
    check(server, 11, 'AC-3', false, 'ja');
    expect(taskOf(server, 11).history.at(-1)?.reason).toBe('ユーザーがAC-3を未達成に戻しました。');
  });

  it('changes nothing when the condition already has the value', () => {
    const { server, events } = start();
    const before = taskOf(server, 11);
    const response = check(server, 11, 'AC-1', true);
    expect(bodyOf<{ changed: boolean }>(response).changed).toBe(false);
    expect(taskOf(server, 11)).toBe(before);
    expect(events).toEqual([]);
  });

  it('refuses what the server refuses', () => {
    const { server, events } = start();
    const url = `${base}/11/acceptance/AC-3`;
    expect(send(server, { method: 'PUT', url, headers: {}, body: '{"done":true}' }).status).toBe(
      403,
    );
    expect(send(server, { method: 'PUT', url, body: '{' }).status).toBe(400);
    expect(check(server, 11, 'AC-3', 'yes').status).toBe(422);
    expect(check(server, 99, 'AC-1', true).status).toBe(404);
    const unknown = check(server, 11, 'AC-9', true);
    expect([
      unknown.status,
      bodyOf<{ error: { code: string; message: string } }>(unknown).error,
    ]).toEqual([
      422,
      expect.objectContaining({
        code: 'invalid_argument',
        message: 'Task #11 has no acceptance condition AC-9.',
      }),
    ]);
    expect(bodyOf<{ error: { code: string } }>(check(server, 16, 'AC-1', true)).error.code).toBe(
      'file_invalid',
    );
    send(server, { method: 'POST', url: `${base}/11/archive`, body: '{}' });
    const archived = check(server, 11, 'AC-3', true);
    expect([archived.status, bodyOf<{ error: { code: string } }>(archived).error.code]).toEqual([
      409,
      'task_archived',
    ]);
    // Only the archive was stored.
    expect(events).toHaveLength(1);
  });
});

describe('automatic Done', () => {
  it('moves an AI task to Done once its last condition is met, as a change of its own', () => {
    const { server, events } = start();
    send(server, {
      method: 'POST',
      url: `${base}/11/answer`,
      body: JSON.stringify({ requestId: '11111111111111111111111111111111', choiceId: 'fifo' }),
    });
    check(server, 11, 'AC-3', true);
    expect(taskOf(server, 11).taskStatus).toBe('doing');
    const last = check(server, 11, 'AC-4', true);
    // The answer is the task as the check left it; Done follows.
    expect(bodyOf<{ task: { taskStatus: string } }>(last).task.taskStatus).toBe('doing');
    const task = taskOf(server, 11);
    expect(task).toMatchObject({
      taskStatus: 'done',
      taskStatusChangedAt: AT,
      agentStatus: 'idle',
      pendingRequestId: null,
      position: 3,
      updatedAt: AT,
    });
    expect(task.history.at(-1)?.reason).toBe('All acceptance conditions are complete.');
    expect(lane(server, 'done')).toEqual([11, 9, 8]);
    expect(events.slice(-2).map((event) => [event.seq, event.changes])).toEqual([
      [3, [{ resource: 'task', id: 11, facets: ['summary', 'document', 'history'] }]],
      [4, [{ resource: 'task', id: 11, facets: ['summary', 'history'] }]],
    ]);
  });

  it('completes a task whose conditions were all met once its request is answered', () => {
    const { server, events } = start();
    send(server, {
      method: 'POST',
      url: `${base}/12/answer`,
      body: JSON.stringify({ requestId: '0123456789abcdef0123456789abcdef', text: 'Replace it.' }),
    });
    expect(taskOf(server, 12).taskStatus).toBe('done');
    expect(events.map((event) => event.changes[0]?.facets)).toEqual([
      ['summary', 'history', 'request'],
      ['summary', 'history'],
    ]);
  });

  it('leaves pending, human and Done tasks where they are, and writes Japanese for a Japanese task', () => {
    const { server } = start();
    // Task 12 has every condition met but waits for an answer.
    expect(taskOf(server, 12).taskStatus).toBe('doing');
    send(server, {
      method: 'PATCH',
      url: `${base}/14`,
      body: JSON.stringify({ acceptance: [{ id: 'AC-1', text: '確認する', done: false }] }),
    });
    check(server, 14, 'AC-1', true);
    expect(taskOf(server, 14).taskStatus).toBe('todo');

    send(server, {
      method: 'PATCH',
      url: `${base}/15`,
      body: JSON.stringify({
        body: '手順を書く',
        acceptance: [{ id: 'AC-1', text: '手順', done: false }],
      }),
    });
    check(server, 15, 'AC-1', true, 'en');
    expect(taskOf(server, 15).taskStatus).toBe('done');
    expect(
      taskOf(server, 15)
        .history.slice(-2)
        .map((entry) => entry.reason),
    ).toEqual(['A person marked AC-1 as met.', 'すべての受入条件を達成しました。']);
    // A task in Done stays there when a condition is unchecked.
    check(server, 15, 'AC-1', false);
    expect(taskOf(server, 15).taskStatus).toBe('done');
  });
});

describe('reorder', () => {
  it('places a card before another in its lane and reports the cards that moved', () => {
    const { server, events } = start();
    expect(lane(server, 'todo')).toEqual([14, 15, 16, 17]);
    const response = reorder(server, 17, 15);
    expect(
      bodyOf<{ task: { id: number; position: number }; changed: boolean }>(response),
    ).toMatchObject({
      task: { id: 17, position: 2 },
      changed: true,
    });
    expect(lane(server, 'todo')).toEqual([14, 17, 15, 16]);
    expect(events.map((event) => event.changes)).toEqual([
      [
        { resource: 'task', id: 17, facets: ['summary'] },
        { resource: 'task', id: 15, facets: ['summary'] },
        { resource: 'task', id: 16, facets: ['summary'] },
      ],
    ]);
  });

  it('moves a card to the end when beforeId is null or not in the lane', () => {
    const { server } = start();
    reorder(server, 14, null);
    expect(lane(server, 'todo')).toEqual([15, 16, 17, 14]);
    reorder(server, 15, 11);
    expect(lane(server, 'todo')).toEqual([16, 17, 14, 15]);
  });

  it('orders Done from the top down', () => {
    const { server } = start();
    expect(lane(server, 'done')).toEqual([9, 8]);
    reorder(server, 8, 9);
    expect(lane(server, 'done')).toEqual([8, 9]);
    expect([taskOf(server, 8).position, taskOf(server, 9).position]).toEqual([2, 1]);
  });

  it('answers changed: false when the order stays, and refuses what the server refuses', () => {
    const { server, events } = start();
    expect(bodyOf<{ changed: boolean }>(reorder(server, 15, 16)).changed).toBe(false);
    expect(reorder(server, 15, 'first').status).toBe(422);
    expect(reorder(server, 99, null).status).toBe(404);
    expect(
      send(server, { method: 'POST', url: `${base}/15/reorder`, headers: {}, body: '{}' }).status,
    ).toBe(403);
    send(server, { method: 'POST', url: `${base}/15/archive`, body: '{}' });
    expect(reorder(server, 15, null).status).toBe(409);
    expect(events).toHaveLength(1);
  });
});
