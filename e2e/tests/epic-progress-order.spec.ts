// The progress table of an epic: a task is dragged into a wave of its own, the waves are saved with the epic, and the
// CLI reads the same order from the progress table.

import { expect, test, type Page, type Locator } from '../helpers/fixtures';
import { agboardOk, mainProject, projectId, resetBoard } from '../helpers/agboard';
import { readBoardAfterReset, waitForSync } from '../helpers/ui';

const task = (page: Page | Locator, title: string) => page.locator('.epic-progress__row', { hasText: title });

/**
 * Drags a card onto the "new wave" area at the bottom with the pointer, as the board's cards are dragged.
 *
 * The dialog zooms in as it opens; cards measured during that animation are not where they end up, so the drag
 * starts when the animations are done. Each move is made in steps so that the drag library sees a path.
 */
async function dragToNewWave(page: Page, dialog: Locator, title: string): Promise<void> {
  await dialog.evaluate((element) =>
    Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)).then(() => undefined),
  );
  const card = task(dialog, title);
  const zone = dialog.locator('.epic-wave__new');
  await zone.scrollIntoViewIfNeeded();
  await card.scrollIntoViewIfNeeded();
  const from = (await card.boundingBox())!;
  const to = (await zone.boundingBox())!;
  await page.mouse.move(from.x + 40, from.y + 20);
  await page.mouse.down();
  await page.mouse.move(from.x + 50, from.y + 30, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 });
  await page.mouse.up();
}

function progressOrder(): number[] {
  const table = JSON.parse(agboardOk(mainProject, ['progress', '--json']).stdout);
  return (table.epics as { tasks: { id: number }[] }[])[0]?.tasks.map((item) => item.id) ?? [];
}

test.beforeEach(() => {
  resetBoard(mainProject);
  agboardOk(mainProject, ['epic', 'add', 'ORDER', '--name', 'Ordered epic', '--color', '#7C3AED', '--actor', 'human']);
  agboardOk(mainProject, ['add', 'First step', '--assignee', 'ai', '--actor', 'human', '--epic', 'ORDER']);
  agboardOk(mainProject, ['add', 'Second step', '--assignee', 'ai', '--actor', 'human', '--epic', 'ORDER']);
  agboardOk(mainProject, ['add', 'Third step', '--assignee', 'ai', '--actor', 'human', '--epic', 'ORDER']);
});

test('a task dragged into a new wave in the progress table is saved with the epic and read back by the CLI', async ({ page }) => {
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

  // Drag the third task into a wave of its own; it leaves the unlisted tasks and heads the order.
  await dragToNewWave(page, dialog, 'Third step');
  await expect(dialog.locator('.epic-progress__list > li').first()).toContainText('Third step');

  // Nothing is stored until Save; the save writes the new order to the epic.
  expect(progressOrder()).toEqual(before);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  expect(progressOrder()).toEqual([third, first, second]);
});

test('cancelling after a drag in the progress table discards the new waves', async ({ page }) => {
  const before = progressOrder();
  await page.goto(`/?project=${projectId(mainProject)}`);
  await waitForSync(page);
  await readBoardAfterReset(page);
  await page.locator('[data-epic-label="ORDER"]').first().click();
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('textbox', { name: 'Title' }) });
  await expect(dialog).toBeVisible();

  await dragToNewWave(page, dialog, 'Third step');
  await expect(dialog.locator('.epic-progress__list > li').first()).toContainText('Third step');

  // Cancel asks first, because the order has changed; discarding closes the dialog and keeps the saved order.
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('dialog', { name: /Discard changes\?/ }).getByRole('button', { name: 'Discard and close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(progressOrder()).toEqual(before);
});

test('a failed save keeps the new waves in the progress table, and trying again saves it', async ({ page }) => {
  const before = progressOrder();
  const [first, second, third] = before as [number, number, number];
  await page.goto(`/?project=${projectId(mainProject)}`);
  await waitForSync(page);
  await readBoardAfterReset(page);
  await page.locator('[data-epic-label="ORDER"]').first().click();
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('textbox', { name: 'Title' }) });
  await expect(dialog).toBeVisible();

  await dragToNewWave(page, dialog, 'Third step');
  await expect(dialog.locator('.epic-progress__list > li').first()).toContainText('Third step');

  // The first save of the order is refused by the server; the dialog stays with the new order.
  // The change itself already made the epic a draft with a PATCH of its own, which goes through.
  let refuse = true;
  await page.route(`**/api/projects/${projectId(mainProject)}/epics/ORDER`, async (route) => {
    if (refuse && route.request().method() === 'PATCH' && 'waves' in route.request().postDataJSON()) {
      refuse = false;
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"database_error","message":"refused"}}' });
    } else {
      await route.continue();
    }
  });
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.locator('.epic-progress__list > li').first()).toContainText('Third step');
  expect(progressOrder()).toEqual(before);

  // Trying again saves the same order.
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(progressOrder()).toEqual([third, first, second]);
});
