// The MSW handlers over the sample-data server: the transport that tests, Storybook, the dev
// sample-data mode and the demo share.
import { describe, expect, it } from 'vitest';
import type { ChangedEvent } from '../../src/shared/data/api/contracts';
import { useMockServer } from '../support/msw';
import { boardOf, PROJECT, start, taskOf } from './mockServerCases';

const TOKEN = { 'X-Agboard-Token': 'mock-token' };

/** Reads the next `changed` event of a stream, or fails after a second. */
function nextChanged(source: EventSource): Promise<ChangedEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no changed event')), 1000);
    source.addEventListener('changed', (event) => {
      clearTimeout(timer);
      resolve(JSON.parse((event as MessageEvent<string>).data) as ChangedEvent);
    });
  });
}

describe('mock handlers: requests', () => {
  it('answers the API from the sample-data server', async () => {
    const { server } = start();
    useMockServer(server);
    const response = await fetch('/api/projects', { headers: TOKEN });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { projects: unknown[] };
    expect(body.projects.length).toBeGreaterThan(0);
  });

  it('carries a write to the server and its answer back', async () => {
    const { server } = start();
    useMockServer(server);
    const before = boardOf(server).tasks.length;
    const response = await fetch(`/api/projects/${PROJECT}/tasks`, {
      method: 'POST',
      headers: { ...TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'From a handler', assignee: 'ai' }),
    });
    expect(response.ok).toBe(true);
    expect(boardOf(server).tasks.length).toBe(before + 1);
  });

  it('reads the metadata field of a multipart form as the body', async () => {
    const { server } = start();
    useMockServer(server);
    const form = new FormData();
    form.set('metadata', JSON.stringify({ title: 'With a form', assignee: 'ai' }));
    const before = boardOf(server).tasks.length;
    const response = await fetch(`/api/projects/${PROJECT}/tasks`, {
      method: 'POST',
      headers: TOKEN,
      body: form,
    });
    expect(response.ok).toBe(true);
    expect(boardOf(server).tasks.length).toBe(before + 1);
  });

  it('passes the page query to the server as page parameters', async () => {
    const { server } = start();
    useMockServer(server, { page: () => '?fail=1' });
    const response = await fetch(`/api/projects/${PROJECT}/summary`, { headers: TOKEN });
    expect(response.ok).toBe(false);
  });

  it('answers a path the server does not know with 404', async () => {
    const { server } = start();
    useMockServer(server);
    expect((await fetch('/api/nothing-here', { headers: TOKEN })).status).toBe(404);
  });

  it('fails a product request that no handler answers', async () => {
    await expect(fetch('/api/projects', { headers: TOKEN })).rejects.toThrow();
  });
});

describe('mock handlers: event stream', () => {
  it('sends ready, then each change the server reports', async () => {
    const { server } = start();
    useMockServer(server);
    const source = new EventSource('/api/events');
    await new Promise((resolve) => source.addEventListener('ready', resolve, { once: true }));
    const changed = nextChanged(source);
    const task = taskOf(server, 14);
    await fetch(`/api/projects/${PROJECT}/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { ...TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `${task.title} (edited)` }),
    });
    const event = await changed;
    expect(event.projectId).toBe(PROJECT);
    expect(event.changes.length).toBeGreaterThan(0);
    source.close();
  });

  it('stops listening to the server once the page closes the stream', async () => {
    const { server } = start();
    let listeners = 0;
    const subscribe = server.subscribe.bind(server);
    server.subscribe = (listener) => {
      listeners += 1;
      const unsubscribe = subscribe(listener);
      return () => {
        listeners -= 1;
        unsubscribe();
      };
    };
    useMockServer(server);
    const source = new EventSource('/api/events');
    await new Promise((resolve) => source.addEventListener('ready', resolve, { once: true }));
    expect(listeners).toBe(1);
    source.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(listeners).toBe(0);
  });

  it('refuses the stream when the page asks for a disconnect', async () => {
    const { server } = start();
    useMockServer(server, { page: () => '?disconnect=1' });
    const source = new EventSource('/api/events');
    await new Promise((resolve) => source.addEventListener('error', resolve, { once: true }));
    expect(source.readyState).toBe(EventSource.CLOSED);
    source.close();
  });
});
