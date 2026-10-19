import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import type {
  Assignee,
  Board,
  Task,
  ColumnName,
  Epic,
  HistoryEvent,
  Problem,
  Project,
} from './src/shared/api/contracts.ts';

/** The mock keeps the board's parts; the version and cursor are made from the revision when it answers. */
interface MockBoard {
  project: Project;
  revision: number;
  epics: Epic[];
  problems: Problem[];
  tasks: Task[];
}

/** An epic the sample board shows: its label and frame on a few cards. */
const SAMPLE_PLAN = `## 目的

共有ファイルの画面を整える。

## 進め方

順に進める。

## 参考条件

- [x] 本文が読める
- [ ] 画像が並ぶ
`;
const SAMPLE_EPIC: Epic = {
  id: 'FILE-SHARE',
  name: 'File share',
  color: '#7C3AED',
  isDraft: false,
  plan: SAMPLE_PLAN,
  body: SAMPLE_PLAN,
  priority: [],
  priorityError: false,
  attachments: [],
  createdAt: '2026-10-01T07:00:00Z',
  updatedAt: '2026-10-01T07:00:00Z',
};
const SAMPLE_EPIC_TASKS = [11, 12, 14];

/** Completion conditions the sample cards show: one part done, and all done. */
const SAMPLE_CONDITIONS: Record<number, Task['acceptance']> = {
  11: [
    { id: 'AC-1', text: 'Tasks move between lanes', done: true },
    { id: 'AC-2', text: 'Each move confirms the status change', done: true },
    { id: 'AC-3', text: 'The history keeps the reason', done: false },
    { id: 'AC-4', text: 'A waiting task goes back to idle', done: false },
  ],
  12: [
    { id: 'AC-1', text: 'The board shows the restore', done: true },
    { id: 'AC-2', text: 'The archive keeps the lane', done: true },
  ],
};

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

function asBoard(project: Project, tasks: Task[]): MockBoard {
  return { project, revision: 1, epics: [SAMPLE_EPIC], problems: [], tasks };
}

function versionOf(board: MockBoard): string {
  return `mock-${board.revision}`;
}

/** A card as the server writes it: the epic is an ID that the board resolves against `epics`. */
function toWireTask({ epic, ...task }: Task) {
  return { ...task, epicId: epic?.id ?? null };
}

/** The board snapshot as the server writes it (`GET /api/projects/{id}/board`). */
function wireBoard(board: MockBoard, tasks: Task[]) {
  return {
    project: board.project,
    version: versionOf(board),
    cursor: `f1:${board.project.id}:${versionOf(board)}`,
    epics: board.epics,
    tasks: tasks.map(toWireTask),
    problems: board.problems,
  };
}

/** A card with a long Markdown description, to try the description rendering with sample data. */
function longMarkdownTask(tasks: Task[]): Task {
  const template = tasks[0] as Task;
  const id = Math.max(...tasks.map((task) => task.id)) + 1;
  return {
    ...template,
    id,
    title: 'Long Markdown description',
    description: readFileSync(
      resolve(import.meta.dirname, 'test/fixtures/long-markdown.md'),
      'utf8',
    ),
    taskStatus: 'todo',
    agentStatus: 'idle',
    pendingReason: null,
    pendingRequestId: null,
    isDraft: false,
    position: tasks.filter((task) => task.taskStatus === 'todo').length + 1,
  };
}

/** A picture for the sample pages, served from the dev server so that it is a real http image. */
const SAMPLE_IMAGE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="312" height="130" viewBox="0 0 312 130"><rect width="312" height="130" fill="#e9effd"/><g fill="none" stroke="#5a6f96" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" transform="translate(136 49)"><rect x="0" y="0" width="40" height="32" rx="4"/><circle cx="10" cy="10" r="3"/><path d="M40 24 28 13 8 32"/></g></svg>';

const EXTRA_PENDING: Record<
  number,
  Pick<Task, 'pendingReason' | 'pendingRequestId' | 'pendingChoices'>
> = {
  11: {
    pendingReason: 'Waiting for a decision on how to order the task moves.',
    pendingRequestId: '11111111111111111111111111111111',
    pendingChoices: [
      { id: 'fifo', label: 'Keep the order they were moved in' },
      { id: 'priority', label: 'Sort by priority' },
    ],
  },
  13: {
    pendingReason: 'Waiting for confirmation on which display to check.',
    pendingRequestId: '13131313131313131313131313131313',
    pendingChoices: [
      { id: 'board', label: 'The board view' },
      { id: 'archive', label: 'The archive view' },
    ],
  },
};

function loadFixtures(): Record<string, MockBoard> {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Board;
  const withEpic = (tasks: Task[]): Task[] =>
    tasks.map((task) => {
      const conditions = SAMPLE_CONDITIONS[task.id];
      // Card 16 has a frontmatter that cannot be read: its body is shown whole, with a notice.
      const broken =
        task.id === 16
          ? {
              ...task,
              body: "---\nacceptance:\n  - id: AC-1\n    text: ''\n---\n\nThe body stays visible.\n",
              acceptance: [],
              acceptanceError: true,
            }
          : task;
      const withConditions = conditions ? { ...broken, acceptance: conditions } : broken;
      // Cards 11 and 13 also wait for an answer, so the Doing lane shows several pending cards at once.
      const extraPending = EXTRA_PENDING[task.id];
      const pending: Task = extraPending
        ? { ...withConditions, agentStatus: 'pending', ...extraPending }
        : withConditions;
      return SAMPLE_EPIC_TASKS.includes(task.id)
        ? {
            ...pending,
            epic: { id: SAMPLE_EPIC.id, name: SAMPLE_EPIC.name, color: SAMPLE_EPIC.color },
          }
        : pending;
    });
  const [first, second, third] = SAMPLE_PROJECTS as [Project, Project, Project];
  return {
    [first.id]: asBoard(first, withEpic([...fixture.tasks, longMarkdownTask(fixture.tasks)])),
    [second.id]: asBoard(second, withEpic(fixture.tasks.slice(0, 3))),
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
  const update = (id: string, change: (board: MockBoard) => Task[]) => {
    const board = boards[id];
    if (!board) return;
    boards = {
      ...boards,
      [id]: { ...board, revision: board.revision + 1, tasks: change(board) },
    };
    broadcastChanged();
  };
  const taskMarkdown = (body: string, acceptance: Task['acceptance'], history: Task['history']) =>
    `---\nacceptance: ${JSON.stringify(acceptance)}\nhistory: ${JSON.stringify(history)}\n---\n\n${body}`;

  return {
    name: 'agboard-mock-api',
    apply: 'serve',
    transformIndexHtml: (html) => html.replace('{{AGBOARD_TOKEN}}', 'mock-token'),
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
        const taskWritePath =
          /^\/api\/projects\/([^/]+)\/tasks\/(\d+)(\/multipart|\/draft|\/epic)?$/.exec(path);
        const method = req.method ?? '';
        if (
          (epicPath && ['PATCH', 'POST', 'DELETE'].includes(method)) ||
          (taskWritePath && ['PATCH', 'PUT'].includes(method))
        ) {
          const target = boards[(epicPath ?? taskWritePath)?.[1] ?? ''];
          if (!target)
            return sendError(res, 404, 'project_not_found', 'project not found.', 'Unknown ID.');
          const input =
            method === 'PATCH' && !epicPath?.[3] && !taskWritePath?.[3]
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
          const taskId = Number(taskWritePath?.[2]);
          const task = target.tasks.find((item) => item.id === taskId);
          if (!task) return sendError(res, 404, 'task_not_found', 'task not found.', 'Unknown ID.');
          const suffix = taskWritePath?.[3] ?? '';
          let next: Task = task;
          if (suffix === '/draft') {
            const body = await readJson(req);
            next = { ...task, isDraft: Boolean(body.isDraft) };
          } else if (suffix === '/epic') {
            const body = await readJson(req);
            const epicId = typeof body.epicId === 'string' ? body.epicId : null;
            const epic = epicId ? target.epics.find((item) => item.id === epicId) : undefined;
            next = {
              ...task,
              epic: epic ? { id: epic.id, name: epic.name, color: epic.color } : null,
            };
          } else if (suffix === '/multipart') {
            for await (const _ of req) void _;
          } else {
            const body = input ?? {};
            const history =
              body.finalize === true && task.isDraft
                ? [
                    ...task.history,
                    { at: new Date().toISOString(), reason: 'Finalized the draft.' },
                  ]
                : task.history;
            const editedBody = typeof body.body === 'string' ? body.body : task.body;
            const editedAcceptance = Array.isArray(body.acceptance)
              ? (body.acceptance as Task['acceptance'])
              : task.acceptance;
            next = {
              ...task,
              ...(typeof body.title === 'string' ? { title: body.title } : {}),
              ...(typeof body.description === 'string' ||
              typeof body.body === 'string' ||
              Array.isArray(body.acceptance)
                ? {
                    body: editedBody,
                    acceptance: editedAcceptance,
                    description: taskMarkdown(editedBody, editedAcceptance, history),
                  }
                : {}),
              history,
              ...(body.finalize === true ? { isDraft: false } : {}),
            };
          }
          boards = {
            ...boards,
            [target.project.id]: {
              ...target,
              revision: target.revision + 1,
              tasks: target.tasks.map((item) => (item.id === taskId ? next : item)),
            },
          };
          broadcastChanged();
          return sendJson(res, 200, { task: toWireTask(next), changed: true });
        }

        const projectMatch = /^\/api\/projects\/([^/]+)\/(board|archive|tasks.*)$/.exec(path);
        const projectId = projectMatch?.[1] ?? '';
        const rest = projectMatch?.[2] ?? '';
        const found = boards[projectId];

        if (req.method === 'GET' && rest === 'archive') {
          if (!found)
            return sendError(res, 404, 'project_not_found', 'project not found.', 'Unknown ID.');
          const archive = wireBoard(
            found,
            found.tasks.filter((task) => task.archivedAt),
          );
          return sendJson(res, 200, {
            project: archive.project,
            version: archive.version,
            cursor: archive.cursor,
            tasks: archive.tasks,
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
                    found.tasks.filter((task) => !task.archivedAt),
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

        const deleteMatch = /^tasks\/(\d+)$/.exec(rest);
        if (req.method === 'DELETE' && deleteMatch) {
          if (!req.headers['x-agboard-token']) {
            return sendError(
              res,
              403,
              'forbidden',
              'request refused.',
              'Missing X-Agboard-Token header.',
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
          if (!found.tasks.some((task) => task.id === id)) {
            return sendError(
              res,
              404,
              'task_not_found',
              `task #${id} not found.`,
              `No task has ID ${id}.`,
            );
          }
          update(projectId, (board) => board.tasks.filter((task) => task.id !== id));
          res.statusCode = 204;
          res.end();
          return;
        }

        const archiveMatch = /^tasks\/(\d+)\/(archive|restore)$/.exec(rest);
        if (req.method === 'POST' && archiveMatch) {
          if (!req.headers['x-agboard-token'])
            return sendError(
              res,
              403,
              'forbidden',
              'request refused.',
              'Missing X-Agboard-Token header.',
            );
          const id = Number(archiveMatch[1]);
          const task = found?.tasks.find((item) => item.id === id);
          if (!task)
            return sendError(res, 404, 'task_not_found', `task #${id} not found.`, 'Unknown ID.');
          update(projectId, (board) =>
            board.tasks.map((item) =>
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
            task: {
              ...task,
              archivedAt: archiveMatch[2] === 'archive' ? new Date().toISOString() : null,
              agentStatus: 'idle',
              pendingReason: null,
              pendingRequestId: null,
            },
          });
        }

        if (req.method === 'POST' && rest === 'tasks/archive-done') {
          if (!req.headers['x-agboard-token'])
            return sendError(
              res,
              403,
              'forbidden',
              'request refused.',
              'Missing X-Agboard-Token header.',
            );
          const input = await readJson(req);
          const ids = new Set((Array.isArray(input.ids) ? input.ids : []).map(Number));
          const archivedAt = new Date().toISOString();
          let count = 0;
          update(projectId, (board) =>
            board.tasks.map((item) => {
              if (!ids.has(item.id) || item.taskStatus !== 'done' || item.archivedAt) return item;
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
            tasks: found?.tasks.filter((task) => ids.has(task.id)) ?? [],
            archivedCount: count,
          });
        }

        const taskMatch = /^tasks\/(\d+)\/(move|answer)$/.exec(rest);
        if (req.method === 'POST' && (rest === 'tasks' || taskMatch)) {
          if (!req.headers['x-agboard-token'])
            return sendError(
              res,
              403,
              'forbidden',
              'request refused.',
              'Missing X-Agboard-Token header.',
            );
          if (!found) {
            return sendError(res, 404, 'project_not_found', 'project not found.', 'Unknown ID.');
          }
          try {
            const input = await readJson(req);
            const now = new Date().toISOString();
            if (rest === 'tasks') {
              const title = String(input.title ?? '').trim();
              if (!title || title.length > 100 || !['ai', 'human'].includes(String(input.assignee)))
                return sendError(
                  res,
                  422,
                  'validation',
                  'invalid task.',
                  'A title and assignee are required.',
                );
              const id = Math.max(0, ...found.tasks.map((task) => task.id)) + 1;
              const event: HistoryEvent = { at: now, reason: 'Created task in Todo.' };
              const task: Task = {
                id,
                title,
                description: String(input.description ?? ''),
                body: '',
                acceptance: [],
                acceptanceError: false,
                assignee: input.assignee as Assignee,
                taskStatus: 'todo',
                taskStatusChangedAt: now,
                position: found.tasks.filter((item) => item.taskStatus === 'todo').length + 1,
                agentStatus: 'idle',
                pendingReason: null,
                pendingRequestId: null,
                pendingChoices: [],
                epic: null,
                createdAt: now,
                updatedAt: now,
                agentStatusChangedAt: now,
                isDraft: input.isDraft === true,
                archivedAt: null,
                history: [event],
                attachments: [],
                evidence: [],
              };
              update(projectId, (board) => [...board.tasks, task]);
              return sendJson(res, 201, { task });
            }
            const id = Number(taskMatch?.[1]);
            const task = found.tasks.find((item) => item.id === id);
            if (!task)
              return sendError(
                res,
                404,
                'task_not_found',
                `task #${id} not found.`,
                `No task has ID ${id}.`,
              );
            const saveTask = (updated: Task) =>
              update(projectId, (board) =>
                board.tasks.map((item) => (item.id === updated.id ? updated : item)),
              );
            if (taskMatch?.[2] === 'move') {
              const suppliedReason = String(input.reason ?? '');
              const reason = suppliedReason.trim()
                ? suppliedReason
                : `User changed the status from ${task.taskStatus} to ${String(input.taskStatus)}.`;
              if (reason.length > 2000)
                return sendError(
                  res,
                  422,
                  'validation',
                  'invalid reason.',
                  'Use up to 2,000 characters for the reason.',
                );
              const target = String(input.taskStatus) as ColumnName;
              if (!['todo', 'doing', 'done'].includes(target) || target === task.taskStatus)
                return sendError(
                  res,
                  422,
                  'validation',
                  'invalid status.',
                  'Choose a different task status.',
                );
              const event: HistoryEvent = { at: now, reason };
              const updated = {
                ...task,
                taskStatus: target,
                taskStatusChangedAt: now,
                agentStatus: 'idle' as const,
                pendingReason: null,
                pendingRequestId: null,
                updatedAt: now,
                agentStatusChangedAt: now,
                history: [...task.history, event],
              };
              saveTask(updated);
              return sendJson(res, 200, { task: updated, changed: true });
            }
            if (task.agentStatus !== 'pending' || input.requestId !== task.pendingRequestId)
              return sendError(
                res,
                409,
                'request_changed',
                'the request has changed.',
                'Refresh the task and answer the current request.',
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
                : task.pendingChoices.find((item) => item.id === choiceId);
            if (choiceId !== undefined && !choice)
              return sendError(
                res,
                422,
                'request_choice_unknown',
                'the choice is not part of this request.',
                'Choose one of the options of the request.',
              );
            const event: HistoryEvent = {
              at: now,
              reason: [choice?.label, text].filter(Boolean).join(' — '),
            };
            const updated = {
              ...task,
              agentStatus: 'idle' as const,
              pendingReason: null,
              pendingRequestId: null,
              pendingChoices: [],
              updatedAt: now,
              agentStatusChangedAt: now,
              history: [...task.history, event],
            };
            saveTask(updated);
            return sendJson(res, 200, { task: updated, changed: true });
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
