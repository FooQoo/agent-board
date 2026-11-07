import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { repoRoot } from './helpers/agboard';

// Each worker starts its own `agboard serve` on a port the system picks, with its own data area (see
// helpers/fixtures.ts), so workers and separate checkouts never share a port or a board. Specs in a file still run
// in order, because many of them build on the board the previous test left.
const workers = Number(process.env.AGBOARD_E2E_WORKERS) || Math.max(1, Math.floor(os.cpus().length / 2));

// Traces, screenshots, and failure context go to the OS temp directory, not into the repository. Playwright empties
// this folder at the start of a run, so each checkout has its own.
const checkout = createHash('sha256').update(repoRoot).digest('hex').slice(0, 8);

export default defineConfig({
  testDir: './tests',
  workers,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: path.join(os.tmpdir(), `agent-board-e2e-results-${checkout}`),
  reporter: [['list']],
  globalSetup: './global-setup.ts',
  use: {
    // baseURL comes from the worker's serve, in helpers/fixtures.ts.
    timezoneId: 'UTC',
    locale: 'en-US',
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    // The WebKit engine (Safari's), for the phone monitor's address checks.
    { name: 'webkit-iphone', testMatch: /monitor-address\.spec\.ts$/, use: { ...devices['iPhone 13'] } },
  ],
});
