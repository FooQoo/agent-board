// @vitest-environment node
// The first-run guide of the sample-data server: it only keeps whether the guide has been seen.
import { describe, expect, it } from 'vitest';
import type { MockServer } from '../../src/app/development/mock-server/server';
import { bodyOf, boardOf, send, start } from './mockServerCases';

interface Guide {
  formatVersion: number;
  status: string;
}

const read = (server: MockServer) => bodyOf<Guide>(send(server, { url: '/api/onboarding' }));
const post = (server: MockServer, body: unknown, url = '/api/onboarding/seen') =>
  send(server, { method: 'POST', url, body: JSON.stringify(body) });

describe('first-run guide in the sample-data server', () => {
  it('offers the guide to a new page', () => {
    const { server } = start();
    expect(read(server)).toEqual({ formatVersion: 2, status: 'unseen' });
  });

  it('records how the guide ended', () => {
    const { server } = start();
    expect(bodyOf<Guide>(post(server, { outcome: 'skipped' }))).toEqual({
      formatVersion: 2,
      status: 'skipped',
    });
    expect(read(server).status).toBe('skipped');
    expect(bodyOf<Guide>(post(server, { outcome: 'completed' })).status).toBe('completed');
    expect(read(server).status).toBe('completed');
  });

  it('refuses an outcome it does not know', () => {
    const { server } = start();
    expect(post(server, { outcome: 'later' }).status).toBe(422);
    expect(read(server).status).toBe('unseen');
  });

  it('has no routes for the old lease and run steps', () => {
    const { server } = start();
    for (const route of ['claim', 'replay', 'heartbeat', 'skip', 'recover']) {
      expect(post(server, {}, `/api/onboarding/${route}`).status).toBe(404);
    }
  });

  it('leaves the board as it is', () => {
    const { server } = start();
    const before = boardOf(server).tasks.length;
    post(server, { outcome: 'completed' });
    expect(boardOf(server).tasks).toHaveLength(before);
  });
});
