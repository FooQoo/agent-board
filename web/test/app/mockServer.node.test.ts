// @vitest-environment node
// The sample-data server in Node, as the Vite dev server runs it.
import { describe, expect, it } from 'vitest';
import { mockServerCases, transcript } from './mockServerCases';

describe('mock server in Node', () => {
  it('runs without a window', () => {
    expect(typeof window).toBe('undefined');
  });

  mockServerCases();

  it('gives the same results as in a browser', async () => {
    await expect(`${JSON.stringify(transcript(), null, 2)}\n`).toMatchFileSnapshot(
      './__snapshots__/mockServer.transcript.snap',
    );
  });
});
