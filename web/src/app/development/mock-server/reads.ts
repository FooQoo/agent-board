import {
  epicDetailEvents,
  ndjson,
  requestedSections,
  summaryOfBoard,
  taskDetailEvents,
} from '../boardWire.ts';
import type { DetailEvent } from '../../../shared/data/api/contracts.ts';
import type { Routes } from './types.ts';
import { boardView, error, json, ndjsonResponse, projectNotFound, wireBoard } from './wire.ts';

/** How long `?slow=1` holds the board back: long enough to look at the loading state. */
export const SLOW_MS = 60 * 60 * 1000;

const READ_PATH =
  /^\/api\/projects\/([^/]+)\/(board|summary|archive|(?:tasks|epics)\/[^/]+\/detail)$/;

/** The board, the Summary, the archive and the Detail streams of a project. */
export const readRoutes: Routes = (context, request) => {
  const match = request.method === 'GET' ? READ_PATH.exec(request.url.pathname) : null;
  if (!match) return null;
  const found = context.boards()[match[1] ?? ''];
  if (!found) return projectNotFound();
  const rest = match[2] ?? '';
  const { page } = request;

  if (rest === 'archive') {
    const archive = wireBoard(
      found,
      found.tasks.filter((task) => task.archivedAt),
    );
    return json(200, {
      project: archive.project,
      version: archive.version,
      cursor: archive.cursor,
      tasks: archive.tasks,
    });
  }

  if (rest === 'summary' || rest === 'board') {
    if (page.get('fail') === '1')
      return error(500, 'database_error', 'cannot open the board.', 'Mock failure (?fail=1).');
    const shown = page.get('empty') === '1' ? [] : found.tasks.filter((task) => !task.archivedAt);
    const response = json(
      200,
      rest === 'summary' ? summaryOfBoard(boardView(found, shown)) : wireBoard(found, shown),
    );
    return page.get('slow') === '1' ? { ...response, delayMs: SLOW_MS } : response;
  }

  const [kind, rawName] = rest.split('/');
  const name = decodeURIComponent(rawName ?? '');
  const board = boardView(found, found.tasks);
  let events: DetailEvent[] | null = null;
  if (kind === 'tasks') {
    const task = board.tasks.find((item) => item.id === Number(name));
    if (task)
      events = taskDetailEvents(
        found.project.id,
        task,
        requestedSections(request.url.search, ['document', 'history']),
      );
  } else {
    const epic = board.epics.find((item) => item.id === name);
    if (epic) events = epicDetailEvents(found.project.id, epic);
  }
  if (!events) return error(404, 'task_not_found', 'not found.', 'Unknown ID.');
  return ndjsonResponse(ndjson(events));
};
