import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { mainOrigin } from './helpers/agboard';

// The main serve (port 7631) and the CLI helper share one AGBOARD_HOME, so the
// specs run one at a time. states.spec.ts starts its own serve on 7632.
export default defineConfig({
  testDir: './tests',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Traces, screenshots, and failure context go to the OS temp directory, not into the repository.
  outputDir: path.join(os.tmpdir(), 'agent-board-e2e-results'),
  reporter: [['list']],
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  use: {
    baseURL: `${mainOrigin}/`,
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
