import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import type {
  Actor,
  Assignee,
  Board,
  Card,
  ColumnName,
  Epic,
  HistoryEvent,
  Problem,
  Project,
} from './src/types';

/** The mock keeps the board's parts; the version and cursor are made from the revision when it answers. */
interface MockBoard {
  project: Project;
  revision: number;
  epics: Epic[];
  problems: Problem[];
  cards: Card[];
}

/** An epic the sample board shows: its label and frame on a few cards. */
const SAMPLE_EPIC: Epic = {
  id: 'FILE-SHARE',
  name: 'File share',
  color: '#7C3AED',
  isDraft: false,
  plan: '## 目的\n\n共有ファイルの画面を整える。\n\n## 対象範囲\n\nボードと詳細。\n\n## 完了条件と確認結果\n\n- [ ] AC-1. 本文が読める\n  - 確認結果: 未確認\n  - 根拠: 未記入\n  - 調整役の確認: 未確認\n\n## 進め方\n\n順に進める。\n',
  attachments: [],
  createdAt: '2026-10-01T07:00:00Z',
  updatedAt: '2026-10-01T07:00:00Z',
};
const SAMPLE_EPIC_CARDS = [11, 12, 14];

const FIXTURE_PATH = resolve(import.meta.dirname, 'test/fixtures/board.json');
const SLOW_MS = 60 * 60 * 1000;

/** The sample projects. The first holds the fixture board, the second a smaller one, the third none. */
const SAMPLE_PROJECTS: Project[] = [
  {
    id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    name: 'agent-board',
    createdAt: '2026-10-01T07:00:00Z',
  },
  { id: 'b2c3d4e5f60718293a4b5c6d7e8f90a1', name: 'knowledge', createdAt: '2026-10-01T08:00:00Z' },
  { id: 'c3d4e5f60718293a4b5c6d7e8f90a1b2', name: 'tech-blog', createdAt: '2026-10-01T09:00:00Z' },
];

function asBoard(project: Project, cards: Card[]): MockBoard {
  return { project, revision: 1, epics: [SAMPLE_EPIC], problems: [], cards };
}

function versionOf(board: MockBoard): string {
  return `mock-${board.revision}`;
}

/** A card as the server writes it: the epic is an ID that the board resolves against `epics`. */
function toWireCard({ epic, ...card }: Card) {
  return { ...card, epicId: epic?.id ?? null };
}

/** The board snapshot as the server writes it (`GET /api/projects/{id}/board`). */
function wireBoard(board: MockBoard, cards: Card[]) {
  return {
    project: board.project,
    version: versionOf(board),
    cursor: `f1:${board.project.id}:${versionOf(board)}`,
    epics: board.epics,
    cards: cards.map(toWireCard),
    problems: board.problems,
  };
}

/** A card with a long Markdown description, to try the description rendering with sample data. */
function longMarkdownCard(cards: Card[]): Card {
  const template = cards[0] as Card;
  const id = Math.max(...cards.map((card) => card.id)) + 1;
  return {
    ...template,
    id,
    title: 'Long Markdown description',
    description: readFileSync(
      resolve(import.meta.dirname, 'test/fixtures/long-markdown.md'),
      'utf8',
    ),
    cardStatus: 'todo',
    agentStatus: 'idle',
    pendingReason: null,
    pendingRequestId: null,
    isDraft: false,
    position: cards.filter((card) => card.cardStatus === 'todo').length + 1,
  };
}

/** A picture for the sample pages, served from the dev server so that it is a real http image. */
const SAMPLE_IMAGE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="312" height="130" viewBox="0 0 312 130"><rect width="312" height="130" fill="#e9effd"/><g fill="none" stroke="#5a6f96" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" transform="translate(136 49)"><rect x="0" y="0" width="40" height="32" rx="4"/><circle cx="10" cy="10" r="3"/><path d="M40 24 28 13 8 32"/></g></svg>';

function loadFixtures(): Record<string, MockBoard> {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Board;
  const withEpic = (cards: Card[]): Card[] =>
    cards.map((card) =>
      SAMPLE_EPIC_CARDS.includes(card.id)
        ? {
            ...card,
            epic: { id: SAMPLE_EPIC.id, name: SAMPLE_EPIC.name, color: SAMPLE_EPIC.color },
          }
        : card,
    );
  const [first, second, third] = SAMPLE_PROJECTS as [Project, Project, Project];
  return {
    [first.id]: asBoard(first, withEpic([...fixture.cards, longMarkdownCard(fixture.cards)])),
    [second.id]: asBoard(second, withEpic(fixture.cards.slice(0, 3))),
    [third.id]: asBoard(third, []),
  };
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
 * Page query parameters: `project` (which project is shown), `empty`, `fail` and `slow` (the board of the
 * shown project), `projects=none` (no projects), `projectsFail=1` (the list fails), `disconnect`.
 */
export function mockApi(): Plugin {
  let boards = loadFixtures();
  const clients = new Set<ServerResponse>();

  const broadcastChanged = () => {
    for (const client of clients) client.write('event: changed\ndata: {}\n\n');
  };
  const update = (id: string, change: (board: MockBoard) => Card[]) => {
    const board = boards[id];
    if (!board) return;
    boards = {
      ...boards,
      [id]: { ...board, revision: board.revision + 1, cards: change(board) },
    };
    broadcastChanged();
  };
  const nextEventId = (board: MockBoard) =>
    String(
      Math.max(0, ...board.cards.flatMap((card) => card.history.map((item) => Number(item.id)))) +
        1,
    );

  return {
    name: 'skan-mock-api',
    apply: 'serve',
    transformIndexHtml: (html) => html.replace('{{SKAN_TOKEN}}', 'mock-token'),
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        const path = url.pathname;
        if (path === '/__mock/sample.svg') {
          res.setHeader('Content-Type', 'image/svg+xml');
          return res.end(SAMPLE_IMAGE);
        }
        if (!path.startsWith('/api/')) return next();
        const params = pageParams(req);

        if (req.method === 'GET' && path === '/api/projects') {
          if (params.get('projectsFail') === '1') {
            return sendError(
              res,
              500,
              'database_error',
              'cannot open the projects.',
              'Mock failure (?projectsFail=1).',
            );
          }
          const projects = params.get('projects') === 'none' ? [] : SAMPLE_PROJECTS;
          return sendJson(res, 200, { projects, catalogVersion: 'mock-catalog' });
        }

        // The epic and card writes of the editing dialogs (edit, epic, draft, membership).
        const epicPath =
          /^\/api\/projects\/([^/]+)\/epics\/([^/]+)(\/attachments(?:\/[^/]+)?)?$/.exec(path);
        const cardWritePath =
          /^\/api\/projects\/([^/]+)\/cards\/(\d+)(\/multipart|\/draft|\/epic)?$/.exec(path);
        const method = req.method ?? '';
        if (
          (epicPath && ['PATCH', 'POST', 'DELETE'].includes(method)) ||
          (cardWritePath && ['PATCH', 'PUT'].includes(method))
        ) {
          const target = boards[(epicPath ?? cardWritePath)?.[1] ?? ''];
          if (!target)
            return sendError(res, 404, 'project_not_found', 'project not found.', 'Unknown ID.');
          const input =
            method === 'PATCH' && !epicPath?.[3] && !cardWritePath?.[3]
              ? await readJson(req)
              : null;
          if (epicPath) {
            const epicId = decodeURIComponent(epicPath[2] ?? '');
            const epic = target.epics.find((item) => item.id === epicId);
            if (!epic)
              return sendError(res, 404, 'epic_not_found', 'epic not found.', 'Unknown ID.');
            if (!epicPath[3]) {
              const patch = input ?? {};
              const next: Epic = {
                ...epic,
                name: typeof patch.name === 'string' ? patch.name : epic.name,
                color: typeof patch.color === 'string' ? patch.color : epic.color,
                isDraft: typeof patch.isDraft === 'boolean' ? patch.isDraft : epic.isDraft,
                plan: typeof patch.plan === 'string' ? patch.plan : epic.plan,
              };
              boards = {
                ...boards,
                [target.project.id]: {
                  ...target,
                  revision: target.revision + 1,
                  epics: target.epics.map((item) => (item.id === epicId ? next : item)),
                },
              };
              broadcastChanged();
              return sendJson(res, 200, { epic: next, changed: true });
            }
            // Images: the mock keeps the form body out of the way and answers with the epic as it is.
            for await (const _ of req) void _;
            return sendJson(res, 200, { epic });
          }
          const cardId = Number(cardWritePath?.[2]);
          const card = target.cards.find((item) => item.id === cardId);
          if (!card) return sendError(res, 404, 'card_not_found', 'card not found.', 'Unknown ID.');
          const suffix = cardWritePath?.[3] ?? '';
          let next: Card = card;
          if (suffix === '/draft') {
            const body = await readJson(req);
            next = { ...card, isDraft: Boolean(body.isDraft) };
          } else if (suffix === '/epic') {
            const body = await readJson(req);
            const epicId = typeof body.epicId === 'string' ? body.epicId : null;
            const epic = epicId ? target.epics.find((item) => item.id === epicId) : undefined;
            next = {
              ...card,
              epic: epic ? { id: epic.id, name: epic.name, color: epic.color } : null,
            };
          } else if (suffix === '/multipart') {
            for await (const _ of req) void _;
          } else {
            const body = input ?? {};
            next = {
              ...card,
              ...(typeof body.title === 'string' ? { title: body.title } : {}),
              ...(typeof body.description === 'string' ? { description: body.description } : {}),
              ...(body.finalize === true ? { isDraft: false } : {}),
            };
          }
          boards = {
            ...boards,
            [target.project.id]: {
              ...target,
              revision: target.revision + 1,
              cards: target.cards.map((item) => (item.id === cardId ? next : item)),
            },
          };
          broadcastChanged();
          return sendJson(res, 200, { card: toWireCard(next), changed: true });
        }

        const projectMatch = /^\/api\/projects\/([^/]+)\/(board|archive|cards.*)$/.exec(path);
        const projectId = projectMatch?.[1] ?? '';
        const rest = projectMatch?.[2] ?? '';
        const found = boards[projectId];

        if (req.method === 'GET' && rest === 'archive') {
          if (!found)
            return sendError(res, 404, 'project_not_found', 'project not found.', 'Unknown ID.');
          const archive = wireBoard(
            found,
            found.cards.filter((card) => card.archivedAt),
          );
          return sendJson(res, 200, {
            project: archive.project,
            version: archive.version,
            cursor: archive.cursor,
            cards: archive.cards,
          });
        }

        if (req.method === 'GET' && rest === 'board') {
          if (!found) {
            return sendError(res, 404, 'project_not_found', 'project not found.', 'Unknown ID.');
          }
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
            sendJson(
              res,
              200,
              params.get('empty') === '1'
                ? wireBoard(found, [])
                : wireBoard(
                    found,
                    found.cards.filter((card) => !card.archivedAt),
                  ),
            );
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

        const deleteMatch = /^cards\/(\d+)$/.exec(rest);
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
          if (!found) {
            return sendError(res, 404, 'project_not_found', 'project not found.', 'Unknown ID.');
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
          if (!found.cards.some((card) => card.id === id)) {
            return sendError(
              res,
              404,
              'card_not_found',
              `card #${id} not found.`,
              `No card has ID ${id}.`,
            );
          }
          update(projectId, (board) => board.cards.filter((card) => card.id !== id));
          res.statusCode = 204;
          res.end();
          return;
        }

        const archiveMatch = /^cards\/(\d+)\/(archive|restore)$/.exec(rest);
        if (req.method === 'POST' && archiveMatch) {
          if (!req.headers['x-skan-token'])
            return sendError(
              res,
              403,
              'forbidden',
              'request refused.',
              'Missing X-Skan-Token header.',
            );
          const id = Number(archiveMatch[1]);
          const card = found?.cards.find((item) => item.id === id);
          if (!card)
            return sendError(res, 404, 'card_not_found', `card #${id} not found.`, 'Unknown ID.');
          update(projectId, (board) =>
            board.cards.map((item) =>
              item.id === id
                ? {
                    ...item,
                    archivedAt: archiveMatch[2] === 'archive' ? new Date().toISOString() : null,
                    agentStatus: 'idle',
                    pendingReason: null,
                    pendingRequestId: null,
                  }
                : item,
            ),
          );
          return sendJson(res, 200, {
            card: {
              ...card,
              archivedAt: archiveMatch[2] === 'archive' ? new Date().toISOString() : null,
              agentStatus: 'idle',
              pendingReason: null,
              pendingRequestId: null,
            },
          });
        }

        if (req.method === 'POST' && rest === 'cards/archive-done') {
          if (!req.headers['x-skan-token'])
            return sendError(
              res,
              403,
              'forbidden',
              'request refused.',
              'Missing X-Skan-Token header.',
            );
          const input = await readJson(req);
          const ids = new Set((Array.isArray(input.ids) ? input.ids : []).map(Number));
          const archivedAt = new Date().toISOString();
          let count = 0;
          update(projectId, (board) =>
            board.cards.map((item) => {
              if (!ids.has(item.id) || item.cardStatus !== 'done' || item.archivedAt) return item;
              count += 1;
              return {
                ...item,
                archivedAt,
                agentStatus: 'idle' as const,
                pendingReason: null,
                pendingRequestId: null,
              };
            }),
          );
          return sendJson(res, 200, {
            cards: found?.cards.filter((card) => ids.has(card.id)) ?? [],
            archivedCount: count,
          });
        }

        const cardMatch = /^cards\/(\d+)\/(move|answer)$/.exec(rest);
        if (req.method === 'POST' && (rest === 'cards' || cardMatch)) {
          if (!req.headers['x-skan-token'])
            return sendError(
              res,
              403,
              'forbidden',
              'request refused.',
              'Missing X-Skan-Token header.',
            );
          if (!found) {
            return sendError(res, 404, 'project_not_found', 'project not found.', 'Unknown ID.');
          }
          try {
            const input = await readJson(req);
            const now = new Date().toISOString();
            if (rest === 'cards') {
              const title = String(input.title ?? '').trim();
              if (!title || title.length > 100 || !['ai', 'human'].includes(String(input.assignee)))
                return sendError(
                  res,
                  422,
                  'validation',
                  'invalid card.',
                  'A title and assignee are required.',
                );
              const id = Math.max(0, ...found.cards.map((card) => card.id)) + 1;
              const event: HistoryEvent = {
                id: nextEventId(found),
                kind: 'created',
                actor: 'human',
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
                position: found.cards.filter((item) => item.cardStatus === 'todo').length + 1,
                agentStatus: 'idle',
                pendingReason: null,
                pendingRequestId: null,
                pendingChoices: [],
                epic: null,
                createdAt: now,
                updatedAt: now,
                agentStatusChangedAt: now,
                isDraft: false,
                archivedAt: null,
                history: [event],
                attachments: [],
                evidence: [],
              };
              update(projectId, (board) => [...board.cards, card]);
              return sendJson(res, 201, { card });
            }
            const id = Number(cardMatch?.[1]);
            const card = found.cards.find((item) => item.id === id);
            if (!card)
              return sendError(
                res,
                404,
                'card_not_found',
                `card #${id} not found.`,
                `No card has ID ${id}.`,
              );
            const saveCard = (updated: Card) =>
              update(projectId, (board) =>
                board.cards.map((item) => (item.id === updated.id ? updated : item)),
              );
            if (cardMatch?.[2] === 'move') {
              const reason = String(input.reason ?? '').trim();
              if (!reason || reason.length > 2000)
                return sendError(
                  res,
                  422,
                  'validation',
                  'invalid reason.',
                  'A reason up to 2,000 characters is required.',
                );
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
                id: nextEventId(found),
                kind: 'lane',
                actor: 'human' as Actor,
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
            const choiceId = typeof input.choiceId === 'string' ? input.choiceId : undefined;
            const text = typeof input.text === 'string' ? input.text.trim() : '';
            if (text.length > 2000)
              return sendError(
                res,
                422,
                'validation',
                'invalid text.',
                'An answer up to 2,000 characters is allowed.',
              );
            if (choiceId === undefined && text === '')
              return sendError(
                res,
                422,
                'validation',
                'answer_empty.',
                'Choose an option or write an answer.',
              );
            const choice =
              choiceId === undefined
                ? undefined
                : card.pendingChoices.find((item) => item.id === choiceId);
            if (choiceId !== undefined && !choice)
              return sendError(
                res,
                422,
                'request_choice_unknown',
                'the choice is not part of this request.',
                'Choose one of the options of the request.',
              );
            const event: HistoryEvent = {
              id: nextEventId(found),
              kind: 'answer',
              actor: 'human',
              reason: text === '' ? null : text,
              fromCardStatus: card.cardStatus,
              toCardStatus: card.cardStatus,
              fromAgentStatus: 'pending',
              toAgentStatus: 'idle',
              requestId: card.pendingRequestId,
              question: card.pendingReason,
              choices: card.pendingChoices,
              choiceId: choice?.id ?? null,
              choiceLabel: choice?.label ?? null,
              at: now,
            };
            const updated = {
              ...card,
              agentStatus: 'idle' as const,
              pendingReason: null,
              pendingRequestId: null,
              pendingChoices: [],
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
          boards = loadFixtures();
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
