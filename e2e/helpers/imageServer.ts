import http from 'node:http';

/** A 1x1 PNG. */
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

export interface ImageServer {
  port: number;
  /** The origin the pages use for external images, an `http` URL on the loopback address. */
  origin: string;
  /** The `Referer` header of each request, or null when the browser sent none. */
  referers: (string | null)[];
  /** The paths requested, in order. */
  paths: string[];
  close: () => Promise<void>;
}

/**
 * A tiny sample server standing in for an external image host. `/ok.png` is an image; `/page.html` is a
 * page the links point to; any other path is a 404 (a broken image).
 */
export async function startImageServer(port: number): Promise<ImageServer> {
  const referers: (string | null)[] = [];
  const paths: string[] = [];
  const server = http.createServer((request, response) => {
    paths.push(request.url ?? '');
    referers.push(request.headers.referer ?? null);
    if (request.url?.startsWith('/ok.png')) {
      response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length });
      response.end(png);
    } else if (request.url?.startsWith('/page.html')) {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<!doctype html><title>Linked page</title><h1>Linked page</h1>');
    } else if (request.url?.startsWith('/not-an-image.png')) {
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end('this is text, not an image');
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    port,
    origin: `http://127.0.0.1:${port}`,
    referers,
    paths,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
