// The cases of the sample-data server, shared by a Node run and a jsdom (browser) run, so both
// environments are held to the same results.
import { describe, expect, it } from 'vitest';
import longMarkdown from '../fixtures/long-markdown.md?raw';
import fixture from '../fixtures/board.json';
import type { Board } from '../../src/shared/api/contracts';
import type { ChangedEvent, Summary } from '../../src/shared/data/api/contracts';
import {
  createMockServer,
  SAMPLE_PROJECTS,
  SLOW_MS,
  type MockBoard,
  type MockRequest,
  type MockResponse,
  type MockServer,
} from '../../src/app/development/mock-server/server';

const projectId = (index: number): string => SAMPLE_PROJECTS[index]?.id ?? '';
export const PROJECT = projectId(0);
const SMALL = projectId(1);
const EMPTY = projectId(2);
const TOKEN = { 'x-agboard-token': 'mock-token' };

/** The board of the first sample project as the server holds it now. */
export function boardOf(server: MockServer): MockBoard {
  const board = server.boards()[PROJECT];
  if (!board) throw new Error('The first sample project has no board.');
  return board;
}

export function taskOf(server: MockServer, id: number) {
  const task = boardOf(server).tasks.find((item) => item.id === id);
  if (!task) throw new Error(`No task #${id}.`);
  return task;
}

/** A server with a fixed clock, and every `changed` event it sent. */
export function start(): { server: MockServer; events: ChangedEvent[] } {
  const server = createMockServer({
    fixture: fixture as unknown as Board,
    longMarkdown,
    now: () => '2026-11-09T00:00:00.000Z',
  });
  const events: ChangedEvent[] = [];
  server.subscribe((event) => events.push(event));
  return { server, events };
}

export function send(server: MockServer, request: Partial<MockRequest> & { url: string }) {
  const result = server.handle({ method: 'GET', headers: TOKEN, ...request });
  if (result?.kind !== 'response') throw new Error(`No response for ${request.url}`);
  return result;
}

export const bodyOf = <T = Record<string, unknown>>(response: MockResponse): T =>
  JSON.parse(response.body) as T;

const post = (url: string, body: unknown): Partial<MockRequest> & { url: string } => ({
  method: 'POST',
  url,
  body: JSON.stringify(body),
});

function summaryOf(server: MockServer, project = PROJECT): Summary {
  return bodyOf<Summary>(send(server, { url: `/api/projects/${project}/summary` }));
}

/** A run through every route. Its results are the same in Node and in a browser. */
export function transcript(): unknown[] {
  const { server, events } = start();
  const base = `/api/projects/${PROJECT}`;
  const requests: Array<Partial<MockRequest> & { url: string }> = [
    { url: '/api/projects' },
    { url: `${base}/summary` },
    { url: `${base}/board` },
    { url: `${base}/archive` },
    { url: `${base}/tasks/11/detail` },
    { url: `${base}/tasks/11/detail?sections=history` },
    { url: `${base}/epics/FILE-SHARE/detail` },
    post(`${base}/tasks`, { title: 'New card', assignee: 'ai' }),
    post(`${base}/tasks/15/move`, { taskStatus: 'doing' }),
    post(`${base}/tasks/13/answer`, {
      requestId: '13131313131313131313131313131313',
      choiceId: 'board',
    }),
    { method: 'PATCH', url: `${base}/tasks/14`, body: JSON.stringify({ title: 'Edited' }) },
    { method: 'PUT', url: `${base}/tasks/14/epic`, body: JSON.stringify({ epicId: null }) },
    { method: 'PATCH', url: `${base}/epics/FILE-SHARE`, body: JSON.stringify({ name: 'Files' }) },
    post(`${base}/tasks/8/archive`, {}),
    post(`${base}/tasks/archive-done`, { ids: [9] }),
    { method: 'DELETE', url: `${base}/tasks/16` },
    { url: `${base}/summary` },
    { method: 'POST', url: '/api/__mock/reset' },
    { url: `${base}/summary` },
  ];
  return [
    ...requests.map((request) => {
      const response = send(server, request);
      return { request: `${request.method ?? 'GET'} ${request.url}`, ...response };
    }),
    { events },
  ];
}

export function mockServerCases(): void {
  describe('reads', () => {
    it('lists the sample projects, or none with ?projects=none', () => {
      const { server } = start();
      expect(bodyOf(send(server, { url: '/api/projects' })).projects).toEqual(SAMPLE_PROJECTS);
      expect(
        bodyOf(send(server, { url: '/api/projects', page: '?projects=none' })).projects,
      ).toEqual([]);
      expect(send(server, { url: '/api/projects', page: '?projectsFail=1' }).status).toBe(500);
    });

    it('answers the Summary of each sample board', () => {
      const { server } = start();
      const summary = summaryOf(server);
      expect(summary.project.id).toBe(PROJECT);
      // The fixture cards and the long Markdown card.
      expect(summary.tasks.map((task) => task.id)).toEqual([8, 9, 11, 12, 13, 14, 15, 16, 17]);
      expect(summary.tasks.find((task) => task.id === 11)?.agentStatus).toBe('pending');
      expect(summary.tasks.find((task) => task.id === 12)?.acceptance).toEqual({
        done: 2,
        total: 2,
      });
      expect(summaryOf(server, SMALL).tasks).toHaveLength(3);
      expect(summaryOf(server, EMPTY).tasks).toEqual([]);
    });

    it('applies ?empty, ?fail and ?slow to the board', () => {
      const { server } = start();
      const url = `/api/projects/${PROJECT}/summary`;
      expect(bodyOf<Summary>(send(server, { url, page: '?empty=1' })).tasks).toEqual([]);
      expect(send(server, { url, page: '?fail=1' }).status).toBe(500);
      expect(send(server, { url, page: '?slow=1' }).delayMs).toBe(SLOW_MS);
      expect(send(server, { url }).delayMs).toBeUndefined();
    });

    it('streams the Detail of a task and an epic as NDJSON', () => {
      const { server } = start();
      const response = send(server, { url: `/api/projects/${PROJECT}/tasks/11/detail` });
      expect(response.headers['Content-Type']).toBe('application/x-ndjson');
      const events = response.body
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { type: string });
      expect(events[0]).toMatchObject({ type: 'start', resource: 'task', id: 11 });
      expect(events.filter((event) => event.type === 'acceptance')).toHaveLength(4);
      expect(events.at(-1)?.type).toBe('complete');
      const epic = send(server, { url: `/api/projects/${PROJECT}/epics/FILE-SHARE/detail` });
      expect(epic.body).toContain('"resource":"epic"');
      expect(send(server, { url: `/api/projects/${PROJECT}/tasks/99/detail` }).status).toBe(404);
    });

    it('opens the event stream, or refuses it with ?disconnect=1', () => {
      const { server } = start();
      expect(server.handle({ method: 'GET', url: '/api/events' })).toEqual({ kind: 'events' });
      expect(send(server, { url: '/api/events', page: '?disconnect=1' }).status).toBe(503);
    });

    it('leaves paths outside the mock to the caller and refuses unknown API routes', () => {
      const { server } = start();
      expect(server.handle({ method: 'GET', url: '/index.html' })).toBeNull();
      expect(send(server, { url: '/__mock/sample.svg' }).headers['Content-Type']).toBe(
        'image/svg+xml',
      );
      expect(send(server, { url: '/api/nothing' }).status).toBe(404);
    });
  });

  describe('writes', () => {
    it('creates a card in Todo and reports it', () => {
      const { server, events } = start();
      const response = send(
        server,
        post(`/api/projects/${PROJECT}/tasks`, { title: 'New card', assignee: 'human' }),
      );
      expect(response.status).toBe(201);
      const task = bodyOf<{ task: { id: number; taskStatus: string } }>(response).task;
      expect(task).toMatchObject({ id: 18, taskStatus: 'todo' });
      expect(summaryOf(server).tasks.some((item) => item.id === 18)).toBe(true);
      expect(events).toEqual([
        {
          instanceId: 'mock',
          seq: 1,
          projectId: PROJECT,
          changes: [{ resource: 'task', id: 18, facets: ['summary'] }],
        },
      ]);
    });

    it('refuses a write without the token, and a body that is not JSON', () => {
      const { server, events } = start();
      const url = `/api/projects/${PROJECT}/tasks/15/move`;
      expect(send(server, { method: 'POST', url, headers: {}, body: '{}' }).status).toBe(403);
      expect(send(server, { method: 'POST', url, body: '{' }).status).toBe(400);
      expect(events).toEqual([]);
    });

    it('moves a card, records the reason and settles its request', () => {
      const { server, events } = start();
      const response = send(
        server,
        post(`/api/projects/${PROJECT}/tasks/13/move`, { taskStatus: 'done', reason: 'Checked.' }),
      );
      expect(
        bodyOf<{ task: { taskStatus: string; agentStatus: string } }>(response).task,
      ).toMatchObject({
        taskStatus: 'done',
        agentStatus: 'idle',
      });
      expect(events[0]?.changes).toEqual([
        { resource: 'task', id: 13, facets: ['summary', 'history', 'request'] },
      ]);
      const same = send(
        server,
        post(`/api/projects/${PROJECT}/tasks/13/move`, { taskStatus: 'done' }),
      );
      expect(same.status).toBe(422);
    });

    it('answers a pending request, and refuses an old one', () => {
      const { server } = start();
      const url = `/api/projects/${PROJECT}/tasks/13/answer`;
      expect(send(server, post(url, { requestId: 'old', choiceId: 'board' })).status).toBe(409);
      const ok = send(
        server,
        post(url, { requestId: '13131313131313131313131313131313', choiceId: 'board' }),
      );
      expect(ok.status).toBe(200);
      const task = taskOf(server, 13);
      expect(task.agentStatus).toBe('idle');
      expect(task.history.at(-1)?.reason).toBe('The board view');
    });

    it('edits a card and an epic, and reports the changed sections', () => {
      const { server, events } = start();
      send(server, {
        method: 'PATCH',
        url: `/api/projects/${PROJECT}/tasks/14`,
        body: JSON.stringify({ body: 'New body', acceptance: [] }),
      });
      send(server, {
        method: 'PATCH',
        url: `/api/projects/${PROJECT}/epics/FILE-SHARE`,
        body: JSON.stringify({ color: '#000000' }),
      });
      expect(events.map((event) => event.changes)).toEqual([
        [{ resource: 'task', id: 14, facets: ['summary', 'document', 'history'] }],
        [{ resource: 'epic', id: 'FILE-SHARE', facets: ['summary', 'document'] }],
      ]);
      const board = boardOf(server);
      expect(board.tasks.find((item) => item.id === 14)?.body).toBe('New body');
      expect(board.epics[0]?.color).toBe('#000000');
    });

    it('archives, restores and deletes a card', () => {
      const { server, events } = start();
      const base = `/api/projects/${PROJECT}/tasks`;
      send(server, post(`${base}/8/archive`, {}));
      expect(
        bodyOf<{ tasks: Array<{ id: number }> }>(
          send(server, { url: `/api/projects/${PROJECT}/archive` }),
        ).tasks.map((task) => task.id),
      ).toEqual([8]);
      send(server, post(`${base}/8/restore`, {}));
      expect(
        send(server, { method: 'DELETE', url: `${base}/8`, page: '?deleteFail=1' }).status,
      ).toBe(500);
      expect(send(server, { method: 'DELETE', url: `${base}/8` }).status).toBe(204);
      expect(boardOf(server).tasks.some((task) => task.id === 8)).toBe(false);
      expect(events.at(-1)?.changes).toEqual([{ resource: 'task', id: 8, facets: ['deleted'] }]);
    });

    it('raises the revision with every change, and `seq` by one per event', () => {
      const { server, events } = start();
      const before = bodyOf<{ version: string }>(
        send(server, { url: `/api/projects/${PROJECT}/board` }),
      ).version;
      send(server, post(`/api/projects/${PROJECT}/tasks/15/move`, { taskStatus: 'doing' }));
      send(server, post(`/api/projects/${PROJECT}/tasks/16/move`, { taskStatus: 'doing' }));
      const after = bodyOf<{ version: string }>(
        send(server, { url: `/api/projects/${PROJECT}/board` }),
      ).version;
      expect([before, after]).toEqual(['mock-1', 'mock-3']);
      expect(events.map((event) => event.seq)).toEqual([1, 2]);
    });

    it('restores the sample boards on reset, as a new instance', () => {
      const { server, events } = start();
      send(server, { method: 'DELETE', url: `/api/projects/${PROJECT}/tasks/8` });
      expect(send(server, { method: 'POST', url: '/api/__mock/reset' }).status).toBe(204);
      expect(summaryOf(server).tasks.some((task) => task.id === 8)).toBe(true);
      expect(events.slice(1).map((event) => [event.instanceId, event.seq])).toEqual([
        ['mock-1', 1],
        ['mock-1', 2],
        ['mock-1', 3],
      ]);
    });
  });
}
