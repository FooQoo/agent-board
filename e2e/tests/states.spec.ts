import { expect, test } from '../helpers/fixtures';
import {
  agboardOk,
  createEmptyProject,
  makeHome,
  removeHome,
  startServe,
  stopServe,
  type Serve,
} from '../helpers/agboard';

// This spec stops and restarts its serve, so it starts its own serve with its own
// data directory and shares nothing with the other specs.
test.describe.configure({ mode: 'serial' });

let home: string;
let serve: Serve | undefined;

// Playwright resolves baseURL before beforeAll runs, so whichever comes first starts the serve.
async function ownServe(): Promise<Serve> {
  if (!serve) {
    home = makeHome('states');
    createEmptyProject(home, 'Empty Board');
    serve = await startServe(home);
  }
  return serve;
}

test.use({ baseURL: async ({}, use) => use((await ownServe()).url) });
test.beforeAll(async () => {
  await ownServe();
});

test.afterAll(async () => {
  await stopServe(serve);
  removeHome(home);
});

test('an empty board shows the lanes and a hint for agents', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Empty Board - Agent Board');
  await expect(page.getByRole('banner')).toContainText('Empty Board');
  for (const name of ['Todo', 'Doing', 'Done']) {
    const lane = page.getByRole('region', { name });
    await expect(lane.getByRole('heading', { level: 2 })).toHaveText(name);
    await expect(lane.getByText('0', { exact: true })).toBeVisible();
  }
  await expect(page.getByText('No tasks yet.')).toBeVisible();
  await expect(page.getByText('Add a task to get started.')).toBeVisible();
  await expect(page.getByRole('contentinfo')).toContainText('0 tasks');
  await expect(page.getByRole('contentinfo').getByRole('status')).toHaveText(/^Synced \d{2}:\d{2}$/);
});

test('stopping the serve shows Disconnected, and restarting it reconnects and fetches the latest', async ({
  page,
}) => {
  await page.goto('/');
  const status = page.getByRole('contentinfo').getByRole('status');
  await expect(status).toHaveText(/^Synced \d{2}:\d{2}$/);
  const synced = (await status.innerText()).replace('Synced ', '');

  await stopServe(serve);
  await expect(status).toHaveText(`Disconnected · Last synced ${synced}`);
  // The last board stays on screen.
  await expect(page.getByText('No tasks yet.')).toBeVisible();
  await expect(page.getByRole('contentinfo')).toContainText('0 tasks');

  // The CLI still works while the serve is down, and the change waits for the screen.
  agboardOk('Empty Board', ['add', 'Added while disconnected'], home);

  // The same port, so the open page reconnects.
  serve = await startServe(home, serve!.port);
  await expect(
    page.getByRole('button', { name: /^#1 AI Added while disconnected / }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(status).toHaveText(/^Synced \d{2}:\d{2}$/);
  await expect(page.getByRole('contentinfo')).toContainText('1 task');
  await expect(page.getByText('No tasks yet.')).toHaveCount(0);

  // Live updates work again after the reconnect.
  agboardOk('Empty Board', ['add', 'Added after reconnecting'], home);
  await expect(page.getByRole('button', { name: /^#2 AI Added after reconnecting / })).toBeVisible();
});
