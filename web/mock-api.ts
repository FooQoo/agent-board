import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

interface MockCard {
  id: number;
}

interface MockBoard {
  board: { name: string; created_at: string };
  cards: MockCard[];
}

const FIXTURE_PATH = resolve(import.meta.dirname, 'test/fixtures/board.json');
const SLOW_MS = 60 * 60 * 1000;

function loadFixture(): MockBoard {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as MockBoard;
}

/** Page query parameters (`?empty=1` and so on) reach the API through the Referer header. */
function pageParams(req: IncomingMessage): URLSearchParams {
  const referer = req.headers.referer;
  if (!referer) return new URLSearchParams();
  try {
    return new URL(referer).searchParams;
  } catch {
    return new URLSearchParams();
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  reason: string,
): void {
  sendJson(res, status, { error: { code, message, reason } });
}

/**
 * Serves `/api/*` from `test/fixtures/board.json` so the screens can be developed without the Rust server.
 * Only registered by `vite --mode mock`; it is never part of the production build.
 *
 * Page query parameters: `empty`, `fail`, `slow`, `disconnect` (see `UNIT_OF_WORK_2.md`).
 */
export function mockApi(): Plugin {
  let state = loadFixture();
  const clients = new Set<ServerResponse>();

  const broadcastChanged = () => {
    for (const client of clients) client.write('event: changed\ndata: {}\n\n');
  };

  return {
    name: 'skan-mock-api',
    apply: 'serve',
    transformIndexHtml: (html) => html.replace('{{SKAN_TOKEN}}', 'mock-token'),
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        const path = url.pathname;
        if (!path.startsWith('/api/')) return next();
        const params = pageParams(req);

        if (req.method === 'GET' && path === '/api/board') {
          if (params.get('fail') === '1') {
            return sendError(
              res,
              500,
              'database_error',
              'cannot open the board.',
              'Mock failure (?fail=1).',
            );
          }
          const respond = () => {
            const body = params.get('empty') === '1' ? { ...state, cards: [] } : state;
            sendJson(res, 200, body);
          };
          if (params.get('slow') === '1') {
            const timer = setTimeout(respond, SLOW_MS);
            res.on('close', () => clearTimeout(timer));
            return;
          }
          return respond();
        }

        if (req.method === 'GET' && path === '/api/events') {
          if (params.get('disconnect') === '1') {
            return sendError(
              res,
              503,
              'database_busy',
              'the board is busy.',
              'Mock disconnect (?disconnect=1).',
            );
          }
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-store',
            Connection: 'keep-alive',
          });
          res.write('event: ready\ndata: {}\n\n');
          clients.add(res);
          const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
          res.on('close', () => {
            clearInterval(keepAlive);
            clients.delete(res);
          });
          return;
        }

        const deleteMatch = /^\/api\/cards\/(\d+)$/.exec(path);
        if (req.method === 'DELETE' && deleteMatch) {
          if (!req.headers['x-skan-token']) {
            return sendError(
              res,
              403,
              'forbidden',
              'request refused.',
              'Missing X-Skan-Token header.',
            );
          }
          if (params.get('deleteFail') === '1') {
            return sendError(
              res,
              500,
              'database_error',
              'cannot open the board.',
              'Mock failure (?deleteFail=1).',
            );
          }
          const id = Number(deleteMatch[1]);
          if (!state.cards.some((card) => card.id === id)) {
            return sendError(
              res,
              404,
              'card_not_found',
              `card #${id} not found.`,
              `No card has ID ${id}.`,
            );
          }
          state = { ...state, cards: state.cards.filter((card) => card.id !== id) };
          res.statusCode = 204;
          res.end();
          broadcastChanged();
          return;
        }

        if (req.method === 'POST' && path === '/api/__mock/reset') {
          state = loadFixture();
          res.statusCode = 204;
          res.end();
          broadcastChanged();
          return;
        }

        sendError(res, 404, 'not_found', 'not found.', `No mock route for ${req.method} ${path}.`);
      });
    },
  };
}
