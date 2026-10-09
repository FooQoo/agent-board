import { defineConfig } from '@playwright/test';
import { mainOrigin } from './helpers/agboard';

// The main serve (port 7631) and the CLI helper share one SKAN_HOME, so the
// specs run one at a time. states.spec.ts starts its own serve on 7632.
export default defineConfig({
  testDir: './tests',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
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
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
