import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import type { Board } from './src/shared/api/contracts.ts';
import { createMockServer } from './src/app/development/mock-server/server.ts';

const FIXTURE_PATH = resolve(import.meta.dirname, 'test/fixtures/board.json');
const LONG_MARKDOWN_PATH = resolve(import.meta.dirname, 'test/fixtures/long-markdown.md');

/** The query of the page that sent the request: page parameters reach the API through the Referer. */
function pageQuery(req: IncomingMessage): string {
  const referer = req.headers.referer;
  if (!referer) return '';
  try {
    return new URL(referer).search;
  } catch {
    return '';
  }
}

function headerOf(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** The body as text; for a multipart form, the text of its `metadata` field (see `MockRequest`). */
async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks);
  const type = headerOf(req, 'content-type') ?? '';
  if (!type.startsWith('multipart/form-data')) return raw.toString('utf8');
  try {
    const form = await new Response(raw, { headers: { 'Content-Type': type } }).formData();
    const metadata = form.get('metadata');
    return typeof metadata === 'string' ? metadata : '';
  } catch {
    return '';
  }
}

/**
 * Serves `/api/*` from `test/fixtures/board.json` so the screens can be developed without the Rust
 * server. The routes live in `src/app/development/mock-server/`; this plugin only reads the
 * fixture files and carries requests, answers and the event stream over Node's HTTP server.
 * Only registered by `vite --mode mock`; it is never part of the production build.
 */
export function mockApi(): Plugin {
  const server = createMockServer({
    fixture: JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Board,
    longMarkdown: readFileSync(LONG_MARKDOWN_PATH, 'utf8'),
  });

  return {
    name: 'agboard-mock-api',
    apply: 'serve',
    transformIndexHtml: (html) => html.replace('{{AGBOARD_TOKEN}}', 'mock-token'),
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '/';
        const method = req.method ?? 'GET';
        if (!url.startsWith('/api/') && !url.startsWith('/__mock/')) return next();
        const result = server.handle({
          method,
          url,
          page: pageQuery(req),
          headers: {
            'x-agboard-token': headerOf(req, 'x-agboard-token'),
            'x-agboard-language': headerOf(req, 'x-agboard-language'),
          },
          body: method === 'GET' || method === 'HEAD' ? '' : await readBody(req),
        });
        if (!result) return next();
        if (result.kind === 'events') return streamEvents(res, server.subscribe);
        const send = () => {
          res.writeHead(result.status, result.headers);
          res.end(result.body);
        };
        if (result.delayMs === undefined) return send();
        const timer = setTimeout(send, result.delayMs);
        res.on('close', () => clearTimeout(timer));
      });
    },
  };
}

/** Opens a `text/event-stream` answer that carries each `changed` event until the page closes it. */
function streamEvents(
  res: ServerResponse,
  subscribe: ReturnType<typeof createMockServer>['subscribe'],
): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  res.write('event: ready\ndata: {}\n\n');
  const unsubscribe = subscribe((event) =>
    res.write(`event: changed\ndata: ${JSON.stringify(event)}\n\n`),
  );
  const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
  res.on('close', () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
}
