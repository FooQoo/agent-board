// The progress table of an epic: a task is moved with the keyboard, the order is saved with the epic, and the CLI
// reads the same order from the progress table.

import { expect, test, type Page, type Locator } from '@playwright/test';
import { agboardOk, mainProject, projectId, resetBoard } from '../helpers/agboard';
import { waitForSync } from '../helpers/ui';

const task = (page: Page | Locator, title: string) => page.locator('.epic-progress__row', { hasText: title });

function progressOrder(): number[] {
  const table = JSON.parse(agboardOk(mainProject, ['progress', '--json']).stdout);
  return (table.epics as { tasks: { id: number }[] }[])[0]?.tasks.map((item) => item.id) ?? [];
}

test.beforeEach(() => {
  resetBoard(mainProject);
  agboardOk(mainProject, ['epic', 'add', 'ORDER', '--name', 'Ordered epic', '--color', '#7C3AED', '--actor', 'human']);
  agboardOk(mainProject, ['add', 'First step', '--assignee', 'ai', '--actor', 'ai', '--epic', 'ORDER']);
  agboardOk(mainProject, ['add', 'Second step', '--assignee', 'ai', '--actor', 'ai', '--epic', 'ORDER']);
  agboardOk(mainProject, ['add', 'Third step', '--assignee', 'ai', '--actor', 'ai', '--epic', 'ORDER']);
});

test('a task moved in the progress table by keyboard is saved with the epic and read back by the CLI', async ({ page }) => {
  // Unlisted tasks follow ID order, so the saved order starts as the creation order.
  const before = progressOrder();
  expect(before).toHaveLength(3);
  const [first, second, third] = before as [number, number, number];

  await page.goto(`/?project=${projectId(mainProject)}`);
  await waitForSync(page);
  await page.locator('[data-epic-label="ORDER"]').first().click();
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('textbox', { name: 'Formal name' }) });
  await expect(dialog).toBeVisible();

  // Pick the third task up by its grip, move it up twice, and drop it at the top.
  const grip = task(dialog, 'Third step').locator('.epic-progress__grip');
  await grip.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Space');
  await expect(dialog.locator('.epic-progress__row').first()).toContainText('Third step');

  // Nothing is stored until Save; the save writes the new order to the epic.
  expect(progressOrder()).toEqual(before);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  expect(progressOrder()).toEqual([third, first, second]);
});

test('cancelling after a move in the progress table discards the new order', async ({ page }) => {
  const before = progressOrder();
  await page.goto(`/?project=${projectId(mainProject)}`);
  await waitForSync(page);
  await page.locator('[data-epic-label="ORDER"]').first().click();
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('textbox', { name: 'Formal name' }) });
  await expect(dialog).toBeVisible();

  const grip = task(dialog, 'Third step').locator('.epic-progress__grip');
  await grip.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Space');
  await expect(dialog.locator('.epic-progress__row').first()).toContainText('Third step');

  // Cancel asks first, because the order has changed; discarding closes the dialog and keeps the saved order.
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('dialog', { name: /Discard changes\?/ }).getByRole('button', { name: 'Discard and close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(progressOrder()).toEqual(before);
});

test('a failed save keeps the new order in the progress table, and trying again saves it', async ({ page }) => {
  const before = progressOrder();
  const [first, second, third] = before as [number, number, number];
  await page.goto(`/?project=${projectId(mainProject)}`);
  await waitForSync(page);
  await page.locator('[data-epic-label="ORDER"]').first().click();
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('textbox', { name: 'Formal name' }) });
  await expect(dialog).toBeVisible();

  const grip = task(dialog, 'Third step').locator('.epic-progress__grip');
  await grip.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Space');

  // The first save is refused by the server; the dialog stays with the new order.
  let refuse = true;
  await page.route(`**/api/projects/${projectId(mainProject)}/epics/ORDER`, async (route) => {
    if (refuse && route.request().method() === 'PATCH') {
      refuse = false;
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"database_error","message":"refused"}}' });
    } else {
      await route.continue();
    }
  });
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.locator('.epic-progress__row').first()).toContainText('Third step');
  expect(progressOrder()).toEqual(before);

  // Trying again saves the same order.
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(progressOrder()).toEqual([third, first, second]);
});
