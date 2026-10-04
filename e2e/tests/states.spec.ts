import { expect, test } from '@playwright/test';
import {
  initEmptyBoard,
  makeHome,
  removeHome,
  agboardOk,
  startServe,
  statesPort,
  stopServe,
  type Serve,
} from '../helpers/agboard';

// This spec stops and restarts its serve, so it owns port 7632 and its own
// data directory and shares nothing with the other specs.
test.describe.configure({ mode: 'serial' });
test.use({ baseURL: `http://127.0.0.1:${statesPort}/` });

let home: string;
let serve: Serve | undefined;

test.beforeAll(async () => {
  home = makeHome('states');
  initEmptyBoard(home, 'Empty Board');
  serve = await startServe(statesPort, home);
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
  await expect(page.getByText('No cards yet.')).toBeVisible();
  await expect(page.getByText('Agents add cards with "agboard add <title>".')).toBeVisible();
  await expect(page.getByRole('contentinfo')).toContainText('0 cards');
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
  await expect(page.getByText('No cards yet.')).toBeVisible();
  await expect(page.getByRole('contentinfo')).toContainText('0 cards');

  // The CLI still works while the serve is down, and the change waits for the screen.
  agboardOk(['add', 'Added while disconnected'], home);

  serve = await startServe(statesPort, home);
  await expect(
    page.getByRole('button', { name: /^#1 AI Added while disconnected / }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(status).toHaveText(/^Synced \d{2}:\d{2}$/);
  await expect(page.getByRole('contentinfo')).toContainText('1 card');
  await expect(page.getByText('No cards yet.')).toHaveCount(0);

  // Live updates work again after the reconnect.
  agboardOk(['add', 'Added after reconnecting'], home);
  await expect(page.getByRole('button', { name: /^#2 AI Added after reconnecting / })).toBeVisible();
});
