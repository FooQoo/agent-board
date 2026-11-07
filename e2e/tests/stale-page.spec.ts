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
import { openManualCreateDialog, waitForSync } from '../helpers/ui';

// This spec restarts its serve while a page is open, so its token goes out of date. It starts its own serve with
// its own data directory.
test.describe.configure({ mode: 'serial' });

let home: string;
let serve: Serve | undefined;

// Playwright resolves baseURL before beforeAll runs, so whichever comes first starts the serve.
async function ownServe(): Promise<Serve> {
  if (!serve) {
    home = makeHome('stale');
    createEmptyProject(home, 'Stale Board');
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

async function addTask(page: import('@playwright/test').Page, title: string): Promise<void> {
  const dialog = await openManualCreateDialog(page);
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test('after a restart, a save from an open page asks for a reload, and the reload lets the same save go through', async ({ page }) => {
  await page.goto('/');
  await waitForSync(page);

  // The serve is restarted: this page still holds the token of the earlier server.
  await stopServe(serve);
  serve = await startServe(home, serve!.port);

  const dialog = await openManualCreateDialog(page);
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill('Typed before the reload');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();

  // The page says it is out of date instead of only failing; the typed text stays on screen until the reload.
  // While the dialog is open the rest of the page is hidden from the accessibility tree, so the notice is found by its class.
  const notice = page.locator('.stale-page');
  await expect(notice).toContainText('This page is out of date');
  await expect(notice).toContainText('anything typed here is lost when you reload');
  expect(agboardOk('Stale Board', ['ls', '--json'], home).stdout).not.toContain('Typed before the reload');

  // Reloading the page loads the current token; the same save then goes through.
  await notice.getByText('Reload page').click();
  await page.waitForLoadState('load');
  await waitForSync(page);
  await expect(page.locator('.stale-page')).toHaveCount(0);
  await addTask(page, 'Saved after the reload');
  expect(agboardOk('Stale Board', ['ls', '--json'], home).stdout).toContain('Saved after the reload');
});
