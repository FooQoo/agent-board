import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const e2eDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(e2eDir, '../web');
const port = Number(process.env.AGBOARD_STORYBOOK_E2E_PORT ?? 8670);
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './storybook',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: path.join(os.tmpdir(), 'agent-board-storybook-e2e-results'),
  reporter: [['list']],
  webServer: {
    command: `pnpm exec vite preview --host 127.0.0.1 --port ${port} --strictPort --outDir storybook-static`,
    cwd: webDir,
    url: `${origin}/iframe.html`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { TZ: 'UTC' },
  },
  use: {
    baseURL: origin,
    timezoneId: 'UTC',
    locale: 'en-US',
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
