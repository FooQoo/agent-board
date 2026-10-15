import os from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

// Documentation site tests. They run against the built VitePress site served by
// `vitepress preview`, so build it first: `pnpm --dir docs build`. This config
// is independent of the app suite: no global setup, no Rust or web build, no
// AGBOARD_HOME. Runners can override the default documentation test port with their assigned port.
const port = Number(process.env.AGBOARD_DOCS_E2E_PORT ?? 8445);

export default defineConfig({
  testDir: './docs',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: path.join(os.tmpdir(), 'agent-board-docs-e2e-results'),
  reporter: [['list']],
  webServer: {
    command: `pnpm --dir ../docs preview --port ${port} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${port}/agent-board/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  use: {
    baseURL: `http://127.0.0.1:${port}/agent-board/`,
    timezoneId: 'UTC',
    locale: 'en-US',
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
