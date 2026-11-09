import type { Task } from '../../../shared/api/contracts.ts';
import type { Change, ChangedEvent } from '../../../shared/data/api/contracts.ts';
import { SAMPLE_IMAGE, SAMPLE_PROJECTS, sampleBoards, type MockBoard } from './boards.ts';
import { editRoutes } from './edits.ts';
import { lifecycleRoutes } from './lifecycle.ts';
import { readRoutes } from './reads.ts';
import type {
  MockContext,
  MockRequest,
  MockResult,
  MockServer,
  MockServerOptions,
  RouteRequest,
  Routes,
} from './types.ts';
import { error, json, noContent } from './wire.ts';

export { SAMPLE_PROJECTS } from './boards.ts';
export type { MockBoard } from './boards.ts';
export { SLOW_MS } from './reads.ts';
export type {
  MockEventStream,
  MockRequest,
  MockResponse,
  MockResult,
  MockServer,
  MockServerOptions,
} from './types.ts';

/**
 * The sample-data server: answers `/api/*` from boards held in memory, the way `agboard serve`
 * answers them, and reports each change as the SSE `changed` event would. It uses no Node API, so
 * the Vite dev server (`web/mock-api.ts`) and a page in a browser can both put it behind their own
 * transport. Only those adapters and the tests import it; the production build does not.
 *
 * Page query parameters, passed as `MockRequest.page`: `empty`, `fail` and `slow` (the board of the
 * shown project), `projects=none` (no projects), `projectsFail=1` (the list fails), `disconnect`
 * (the event stream is refused) and `deleteFail=1` (deleting a card fails).
 */
export function createMockServer(options: MockServerOptions): MockServer {
  const seed = { fixture: options.fixture, longMarkdown: options.longMarkdown };
  const now = options.now ?? (() => new Date().toISOString());
  let boards: Record<string, MockBoard> = sampleBoards(seed);
  const listeners = new Set<(event: ChangedEvent) => void>();
  // A reset starts a new instance, as a restarted server does: the page then drops what it holds.
  let instance = 0;
  let seq = 0;

  const emit = (projectId: string, changes: Change[]) => {
    const event: ChangedEvent = {
      instanceId: instance === 0 ? 'mock' : `mock-${instance}`,
      seq: ++seq,
      projectId,
      changes,
    };
    for (const listener of listeners) listener(event);
  };

  const context: MockContext = {
    boards: () => boards,
    now,
    commit(projectId, next, changes) {
      const board = boards[projectId];
      if (!board) return;
      boards = { ...boards, [projectId]: { ...next, revision: board.revision + 1 } };
      emit(projectId, changes);
    },
    replaceTasks(board, updated, changes) {
      const byId = new Map(updated.map((task): [number, Task] => [task.id, task]));
      context.commit(
        board.project.id,
        { ...board, tasks: board.tasks.map((task) => byId.get(task.id) ?? task) },
        changes,
      );
    },
  };

  const reset = () => {
    boards = sampleBoards(seed);
    instance += 1;
    seq = 0;
    for (const id of Object.keys(boards))
      emit(id, [{ resource: 'project', id, facets: ['summary'] }]);
  };

  const globalRoutes: Routes = (_context, request) => {
    const path = request.url.pathname;
    const { method, page } = request;
    if (method === 'GET' && path === '/api/projects') {
      if (page.get('projectsFail') === '1')
        return error(
          500,
          'database_error',
          'cannot open the projects.',
          'Mock failure (?projectsFail=1).',
        );
      const projects = page.get('projects') === 'none' ? [] : SAMPLE_PROJECTS;
      return json(200, { projects, catalogVersion: 'mock-catalog' });
    }
    if (method === 'GET' && path === '/api/events') {
      if (page.get('disconnect') === '1')
        return error(
          503,
          'database_busy',
          'the board is busy.',
          'Mock disconnect (?disconnect=1).',
        );
      return { kind: 'events' };
    }
    if (method === 'POST' && path === '/api/__mock/reset') {
      reset();
      return noContent();
    }
    return null;
  };

  const routes: Routes[] = [globalRoutes, editRoutes, readRoutes, lifecycleRoutes];

  const handle = (request: MockRequest): MockResult | null => {
    // Only the path and query matter; a non-network base keeps the core free of host names.
    const url = new URL(request.url, 'mock:/');
    if (url.pathname === '/__mock/sample.svg')
      return {
        kind: 'response',
        status: 200,
        headers: { 'Content-Type': 'image/svg+xml' },
        body: SAMPLE_IMAGE,
      };
    if (!url.pathname.startsWith('/api/')) return null;
    const language = request.headers?.['x-agboard-language'];
    const routeRequest: RouteRequest = {
      method: request.method.toUpperCase(),
      url,
      page: new URLSearchParams(request.page ?? ''),
      token: request.headers?.['x-agboard-token'],
      language: language === 'ja' || language === 'en' ? language : undefined,
      body: request.body,
    };
    for (const group of routes) {
      const result = group(context, routeRequest);
      if (result) return result;
    }
    return error(
      404,
      'not_found',
      'not found.',
      `No mock route for ${routeRequest.method} ${url.pathname}.`,
    );
  };

  return {
    handle,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    boards: () => boards,
  };
}
