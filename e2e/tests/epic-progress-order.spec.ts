// The progress table of an epic: a task is moved with the keyboard, the order is saved with the epic, and the CLI
// reads the same order from the progress table.

import { expect, test, type Page, type Locator } from '../helpers/fixtures';
import { agboardOk, mainProject, projectId, resetBoard } from '../helpers/agboard';
import { readBoardAfterReset, waitForSync } from '../helpers/ui';

const task = (page: Page | Locator, title: string) => page.locator('.epic-progress__row', { hasText: title });

/**
 * Picks a row up by its grip, moves it up `steps` places with ArrowUp, and drops it with Space.
 *
 * The drag library handles each key asynchronously: the drag starts after the key, and each arrow key measures
 * the rows and then moves the dragged row to its new place. An arrow key that comes before the drag has started
 * is ignored, and the drop puts the row where the last finished move left it, so keys sent back to back on a
 * slow machine leave the order unchanged. Each key therefore waits until the previous one has taken effect.
 */
async function moveUp(page: Page, dialog: Locator, title: string, steps: number): Promise<void> {
  // The dialog zooms in as it opens; rows measured during that animation are not where they end up.
  await dialog.evaluate((element) =>
    Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)).then(() => undefined),
  );
  const rows = dialog.locator('.epic-progress__row');
  const tops = await rows.evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().top)));
  const from = (await rows.allTextContents()).findIndex((text) => text.includes(title));
  expect(from).toBeGreaterThanOrEqual(steps);

  await task(dialog, title).locator('.epic-progress__grip').focus();
  await page.keyboard.press('Space');
  await expect(dialog.locator('.epic-progress__grip[aria-pressed="true"]')).toHaveCount(1);
  // While it is dragged, the row and the placeholder that keeps its place in the list are both marked.
  const dragged = dialog.locator('.epic-progress__row.is-dragging');
  for (let step = 1; step <= steps; step += 1) {
    await page.keyboard.press('ArrowUp');
    const top = tops[from - step];
    await expect
      .poll(() => dragged.evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().top))))
      .toEqual([top, top]);
  }
  await page.keyboard.press('Space');
  await expect(dialog.locator('.epic-progress__grip[aria-pressed="true"]')).toHaveCount(0);
}

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
  await readBoardAfterReset(page);
  await page.locator('[data-epic-label="ORDER"]').first().click();
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('textbox', { name: 'Title' }) });
  await expect(dialog).toBeVisible();

  // Pick the third task up by its grip, move it up twice, and drop it at the top.
  await moveUp(page, dialog, 'Third step', 2);
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
  await readBoardAfterReset(page);
  await page.locator('[data-epic-label="ORDER"]').first().click();
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('textbox', { name: 'Title' }) });
  await expect(dialog).toBeVisible();

  await moveUp(page, dialog, 'Third step', 2);
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
  await readBoardAfterReset(page);
  await page.locator('[data-epic-label="ORDER"]').first().click();
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('textbox', { name: 'Title' }) });
  await expect(dialog).toBeVisible();

  await moveUp(page, dialog, 'Third step', 2);
  await expect(dialog.locator('.epic-progress__row').first()).toContainText('Third step');

  // The first save of the order is refused by the server; the dialog stays with the new order.
  // The change itself already made the epic a draft with a PATCH of its own, which goes through.
  let refuse = true;
  await page.route(`**/api/projects/${projectId(mainProject)}/epics/ORDER`, async (route) => {
    if (refuse && route.request().method() === 'PATCH' && 'priority' in route.request().postDataJSON()) {
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
