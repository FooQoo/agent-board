import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

// Browser demo tests. They run against the documentation site with the demo copied into
// its demo/ folder, served by `vitepress preview` exactly as GitHub Pages serves it at
// /agent-board/demo/. Build both first, as the Pages workflow does:
//   pnpm --dir docs build && pnpm --dir web build:demo
//   cp -R web/dist-demo docs/.vitepress/dist/demo
// Like the docs suite, it needs no global setup, no Rust build, and no AGBOARD_HOME: the demo
// keeps its board in the page. Runners can override the default port with their assigned port.
const port = Number(process.env.AGBOARD_DEMO_E2E_PORT ?? 8446);
// Playwright empties its output folder at the start of a run, so each checkout has its own.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkout = createHash('sha256').update(repoRoot).digest('hex').slice(0, 8);

export default defineConfig({
  testDir: './demo',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: path.join(os.tmpdir(), `agent-board-demo-e2e-results-${checkout}`),
  reporter: [['list']],
  webServer: {
    command: `pnpm --dir ../docs preview --port ${port} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${port}/agent-board/demo/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  use: {
    baseURL: `http://127.0.0.1:${port}/agent-board/demo/`,
    timezoneId: 'UTC',
    locale: 'en-US',
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
