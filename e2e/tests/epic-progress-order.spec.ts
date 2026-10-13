// The progress table of an epic: a task is moved with the keyboard, the order is saved with the epic, and the CLI
// reads the same order from the progress table.

import { expect, test } from '@playwright/test';
import { agboardOk, mainProject, projectId, resetBoard } from '../helpers/agboard';
import { waitForSync } from '../helpers/ui';

const card = (page: import('@playwright/test').Page, title: string) => page.locator('.epic-progress__row', { hasText: title });

function progressOrder(): number[] {
  const table = JSON.parse(agboardOk(mainProject, ['progress', '--json']).stdout);
  return (table.epics as { cards: { id: number }[] }[])[0]?.cards.map((item) => item.id) ?? [];
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
  const grip = card(dialog, 'Third step').locator('.epic-progress__grip');
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
