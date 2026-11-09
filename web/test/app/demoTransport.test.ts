// The demo build's transport: `fetch`, `EventSource` and pictures answered by the sample-data server
// in the page, so the screens run on a static site.
import { describe, expect, it, vi } from 'vitest';
import { demoImageSource } from '../../src/app/development/demo/images';
import {
  createDemoEventSource,
  createDemoFetch,
  serverPath,
} from '../../src/app/development/demo/transport';
import { boardOf, PROJECT, start, taskOf } from './mockServerCases';

const ORIGIN = 'https://example.test';
const TOKEN = { 'X-Agboard-Token': 'demo-token' };

function demoFetch(page = '') {
  const { server, events } = start();
  const network = vi.fn<typeof fetch>(async () => new Response('from the network'));
  const fetcher = createDemoFetch(server, { origin: ORIGIN, page: () => page, fetch: network });
  return { server, events, network, fetcher };
}

describe('serverPath', () => {
  it('names the API and the sample picture on the page origin', () => {
    expect(serverPath('/api/projects?x=1', ORIGIN)).toBe('/api/projects?x=1');
    expect(serverPath(`${ORIGIN}/__mock/sample.svg`, ORIGIN)).toBe('/__mock/sample.svg');
  });

  it('leaves other paths and other origins alone', () => {
    expect(serverPath('/agent-board/demo/assets/app.js', ORIGIN)).toBeNull();
    expect(serverPath('https://other.test/api/projects', ORIGIN)).toBeNull();
  });
});

describe('demo fetch', () => {
  it('answers the API from the page and never asks the network', async () => {
    const { fetcher, network } = demoFetch();
    const response = await fetcher('/api/projects', { headers: TOKEN });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { projects: unknown[] };
    expect(body.projects.length).toBeGreaterThan(0);
    expect(network).not.toHaveBeenCalled();
  });

  it('passes other addresses to the real fetch', async () => {
    const { fetcher, network } = demoFetch();
    const response = await fetcher('/agent-board/demo/logo-white.png');
    expect(await response.text()).toBe('from the network');
    expect(network).toHaveBeenCalledOnce();
  });

  it('reads a Request object and sends its body', async () => {
    const { fetcher, server } = demoFetch();
    const request = new Request(`${ORIGIN}/api/projects/${PROJECT}/tasks`, {
      method: 'POST',
      headers: { ...TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'From a Request', assignee: 'human' }),
    });
    const response = await fetcher(request);
    expect(response.status).toBe(201);
    expect(boardOf(server).tasks.some((task) => task.title === 'From a Request')).toBe(true);
  });

  it('sends the metadata of a form, as the simple request does', async () => {
    const { fetcher, server, events } = demoFetch();
    const epic = boardOf(server).epics[0];
    const form = new FormData();
    form.set(
      'metadata',
      JSON.stringify({
        requestKind: 'simple',
        description: '\n  Restore the demo board\nWith more detail.',
        epicId: epic?.id,
      }),
    );
    form.set('images', new Blob(['x'], { type: 'image/png' }), 'a.png');
    const response = await fetcher(`/api/projects/${PROJECT}/tasks/multipart`, {
      method: 'POST',
      headers: TOKEN,
      body: form,
    });
    expect(response.status).toBe(201);
    const task = boardOf(server).tasks.find((item) => item.title === 'Restore the demo board');
    expect(task).toBeDefined();
    expect(taskOf(server, task?.id ?? 0).description).toContain('With more detail.');
    expect(task?.assignee).toBe('ai');
    expect(task?.epic?.id).toBe(epic?.id);
    expect(events.length).toBeGreaterThan(0);
  });

  it('gives an empty body to a response without content', async () => {
    const { fetcher } = demoFetch();
    const response = await fetcher('/api/__mock/reset', { method: 'POST', headers: TOKEN });
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });

  it('answers an unknown API path with 404', async () => {
    const { fetcher } = demoFetch();
    expect((await fetcher('/api/events', { headers: TOKEN })).status).toBe(404);
  });

  it('rejects as fetch does when the request is aborted', async () => {
    const { fetcher } = demoFetch();
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetcher('/api/projects', { headers: TOKEN, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('demo EventSource', () => {
  const next = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('opens with a ready event without a build ID, then reports changes', async () => {
    const { server } = start();
    const Source = createDemoEventSource(server, { origin: ORIGIN, page: () => '' });
    const source = new Source('/api/events');
    const seen: string[] = [];
    const changed: string[] = [];
    source.onopen = () => seen.push('open');
    source.addEventListener('ready', (event) => seen.push(`ready ${(event as MessageEvent).data}`));
    source.addEventListener('changed', (event) => changed.push((event as MessageEvent).data));
    expect(source.readyState).toBe(Source.CONNECTING);
    await next();
    expect(seen).toEqual(['open', 'ready {}']);
    expect(source.readyState).toBe(Source.OPEN);

    server.handle({ method: 'POST', url: '/api/__mock/reset', headers: {} });
    await next();
    expect(changed.length).toBeGreaterThan(0);

    source.close();
    const count = changed.length;
    server.handle({ method: 'POST', url: '/api/__mock/reset', headers: {} });
    await next();
    expect(changed.length).toBe(count);
  });

  it('ends with an error when the server refuses the stream', async () => {
    const { server } = start();
    const Source = createDemoEventSource(server, { origin: ORIGIN, page: () => '?disconnect=1' });
    const source = new Source('/api/events');
    const onerror = vi.fn();
    source.onerror = onerror;
    await next();
    expect(onerror).toHaveBeenCalledOnce();
    expect(source.readyState).toBe(Source.CLOSED);
  });
});

describe('demo images', () => {
  it('shows the sample picture as a data URL', () => {
    const { server } = start();
    const src = demoImageSource(server, '/__mock/sample.svg', ORIGIN);
    expect(src?.startsWith('data:image/svg+xml')).toBe(true);
  });

  it('shows an empty picture when the server has none, and leaves other images alone', () => {
    const { server } = start();
    expect(demoImageSource(server, '/api/missing.png', ORIGIN)?.startsWith('data:image/gif')).toBe(
      true,
    );
    expect(demoImageSource(server, '/agent-board/demo/logo-white.png', ORIGIN)).toBeNull();
  });
});
