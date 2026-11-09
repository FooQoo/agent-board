// The sample-data server in a browser window (jsdom), as the demo page runs it.
import { describe, expect, it } from 'vitest';
import { mockServerCases, transcript } from './mockServerCases';

describe('mock server in a browser', () => {
  it('runs in a window', () => {
    expect(typeof window).toBe('object');
  });

  mockServerCases();

  it('gives the same results as in Node', async () => {
    await expect(`${JSON.stringify(transcript(), null, 2)}\n`).toMatchFileSnapshot(
      './__snapshots__/mockServer.transcript.snap',
    );
  });
});
