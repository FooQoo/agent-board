import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import type { Actor, Assignee, Card, ColumnName, HistoryEvent } from './src/types';

interface MockBoard {
  board: { name: string; createdAt: string };
  revision: number;
  cards: Card[];
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

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = '';
  for await (const chunk of req) body += chunk;
  return JSON.parse(body || '{}') as Record<string, unknown>;
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
  const saveCard = (card: Card) => {
    state = {
      ...state,
      revision: state.revision + 1,
      cards: state.cards.map((item) => (item.id === card.id ? card : item)),
    };
    broadcastChanged();
  };
  const nextEventId = () =>
    Math.max(0, ...state.cards.flatMap((card) => card.history.map((item) => item.id))) + 1;

  return {
    name: 'skan-mock-api',
    apply: 'serve',
    transformIndexHtml: (html) => html.replace('{{SKAN_TOKEN}}', 'mock-token'),
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
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
          state = {
            ...state,
            revision: state.revision + 1,
            cards: state.cards.filter((card) => card.id !== id),
          };
          res.statusCode = 204;
          res.end();
          broadcastChanged();
          return;
        }

        const cardMatch = /^\/api\/cards\/(\d+)\/(move|answer)$/.exec(path);
        if (req.method === 'POST' && (path === '/api/cards' || cardMatch)) {
          if (!req.headers['x-skan-token'])
            return sendError(
              res,
              403,
              'forbidden',
              'request refused.',
              'Missing X-Skan-Token header.',
            );
          try {
            const input = await readJson(req);
            const now = new Date().toISOString();
            if (path === '/api/cards') {
              const title = String(input.title ?? '').trim();
              if (!title || title.length > 100 || !['ai', 'human'].includes(String(input.assignee)))
                return sendError(
                  res,
                  422,
                  'validation',
                  'invalid card.',
                  'A title and assignee are required.',
                );
              const id = Math.max(0, ...state.cards.map((card) => card.id)) + 1;
              const actor = (input.actor === 'ai' ? 'ai' : 'human') as Actor;
              const event: HistoryEvent = {
                id: nextEventId(),
                kind: 'created',
                actor,
                reason: null,
                fromCardStatus: null,
                toCardStatus: 'todo',
                fromAgentStatus: null,
                toAgentStatus: 'idle',
                requestId: null,
                at: now,
              };
              const card: Card = {
                id,
                title,
                description: String(input.description ?? ''),
                assignee: input.assignee as Assignee,
                cardStatus: 'todo',
                position: state.cards.filter((item) => item.cardStatus === 'todo').length + 1,
                agentStatus: 'idle',
                pendingReason: null,
                pendingRequestId: null,
                createdAt: now,
                updatedAt: now,
                agentStatusChangedAt: now,
                history: [event],
              };
              state = { ...state, revision: state.revision + 1, cards: [...state.cards, card] };
              broadcastChanged();
              return sendJson(res, 201, { card });
            }
            const id = Number(cardMatch?.[1]);
            const card = state.cards.find((item) => item.id === id);
            if (!card)
              return sendError(
                res,
                404,
                'card_not_found',
                `card #${id} not found.`,
                `No card has ID ${id}.`,
              );
            const reason = String(input.reason ?? '').trim();
            if (!reason || reason.length > 2000)
              return sendError(
                res,
                422,
                'validation',
                'invalid reason.',
                'A reason up to 2,000 characters is required.',
              );
            if (cardMatch?.[2] === 'move') {
              const target = String(input.cardStatus) as ColumnName;
              if (!['todo', 'doing', 'done'].includes(target) || target === card.cardStatus)
                return sendError(
                  res,
                  422,
                  'validation',
                  'invalid status.',
                  'Choose a different card status.',
                );
              const event: HistoryEvent = {
                id: nextEventId(),
                kind: 'lane',
                actor: input.actor === 'ai' ? 'ai' : 'human',
                reason,
                fromCardStatus: card.cardStatus,
                toCardStatus: target,
                fromAgentStatus: card.agentStatus,
                toAgentStatus: 'idle',
                requestId: null,
                at: now,
              };
              const updated = {
                ...card,
                cardStatus: target,
                agentStatus: 'idle' as const,
                pendingReason: null,
                pendingRequestId: null,
                updatedAt: now,
                agentStatusChangedAt: now,
                history: [...card.history, event],
              };
              saveCard(updated);
              return sendJson(res, 200, { card: updated, changed: true });
            }
            if (card.agentStatus !== 'pending' || input.requestId !== card.pendingRequestId)
              return sendError(
                res,
                409,
                'request_changed',
                'the request has changed.',
                'Refresh the card and answer the current request.',
              );
            const event: HistoryEvent = {
              id: nextEventId(),
              kind: 'agent',
              actor: 'human',
              reason,
              fromCardStatus: card.cardStatus,
              toCardStatus: card.cardStatus,
              fromAgentStatus: 'pending',
              toAgentStatus: 'idle',
              requestId: card.pendingRequestId,
              at: now,
            };
            const updated = {
              ...card,
              agentStatus: 'idle' as const,
              pendingReason: null,
              pendingRequestId: null,
              updatedAt: now,
              agentStatusChangedAt: now,
              history: [...card.history, event],
            };
            saveCard(updated);
            return sendJson(res, 200, { card: updated, changed: true });
          } catch {
            return sendError(
              res,
              400,
              'invalid_json',
              'invalid request.',
              'The request body must be JSON.',
            );
          }
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
