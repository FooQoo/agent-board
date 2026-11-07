import { test as base } from '@playwright/test';
import { mainProject, makeHome, removeHome, resetBoard, serveStartTimeout, startServe, stopServe, type Serve } from './agboard';

// Every spec imports `test` and `expect` from here instead of from @playwright/test.
export * from '@playwright/test';

interface WorkerFixtures {
  /** This worker's data area and the main serve on it. */
  mainServe: Serve & { home: string };
}

/**
 * Each worker gets its own data area with the board fixture in the `agent-board` project, and its own
 * `agboard serve` on a port the system picks. The worker records both in its environment, where `mainHome()`,
 * `mainUrl()` and the CLI helpers read them, and every page opens on that serve through `baseURL`. Specs in
 * one worker run one after another, so they share the area as they did when the suite had one worker.
 */
export const test = base.extend<object, WorkerFixtures>({
  mainServe: [
    async ({}, use, workerInfo) => {
      const home = makeHome(`main-${workerInfo.workerIndex}`);
      process.env.AGBOARD_E2E_HOME = home;
      resetBoard(mainProject, home);
      const serve = await startServe(home);
      process.env.AGBOARD_E2E_MAIN_URL = serve.url;
      await use({ ...serve, home });
      await stopServe(serve);
      delete process.env.AGBOARD_E2E_MAIN_URL;
      delete process.env.AGBOARD_E2E_HOME;
      removeHome(home);
    },
    { scope: 'worker', auto: true, timeout: serveStartTimeout + 30_000 },
  ],
  baseURL: async ({ mainServe }, use) => {
    await use(mainServe.url);
  },
});
