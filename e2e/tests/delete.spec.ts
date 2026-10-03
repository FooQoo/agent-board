import { expect, test, type Page } from '@playwright/test';
import { listCards, resetBoard, skanOk, skanOnTerminal } from '../helpers/skan';

test.beforeEach(async ({ page }) => {
  resetBoard();
  skanOk(['add', 'Disposable card', '--desc', 'Delete me']);
  await page.goto('/');
  await expect(page.getByRole('contentinfo').getByRole('status')).toHaveText(/^Synced/);
});

const panel = (page: Page) => page.getByRole('complementary', { name: 'Card details' });
const card = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });
const DISPOSABLE = 17;
const ask = 'Delete #17 "Disposable card"? This cannot be undone.';

test('Cancel closes the confirmation and keeps the card', async ({ page }) => {
  await card(page, DISPOSABLE).click();
  await panel(page).getByRole('button', { name: 'Delete card' }).click();

  const confirm = panel(page).getByRole('group', { name: ask });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText(ask);
  await expect(confirm.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();

  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Disposable card');
  await expect(card(page, DISPOSABLE)).toBeVisible();
  expect(listCards().map((c) => c.id)).toContain(DISPOSABLE);
});

test('Delete removes the card and clears the selection', async ({ page }) => {
  await card(page, DISPOSABLE).click();
  await panel(page).getByRole('button', { name: 'Delete card' }).click();
  await panel(page).getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(panel(page)).toContainText('Select a card to see its details.');
  await expect(card(page, DISPOSABLE)).toHaveCount(0);
  await expect(page.getByRole('contentinfo')).toContainText('8 cards');
  expect(listCards().map((c) => c.id)).not.toContain(DISPOSABLE);
  // The numbering goes on; IDs are never reused.
  expect(JSON.parse(skanOk(['add', 'Next', '--json']).stdout).card.id).toBe(18);
});

test('a card the CLI deletes while selected clears the selection', async ({ page }) => {
  await card(page, 15).click();
  await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Write the setup guide');

  // A person at a terminal confirms the deletion with y.
  const result = skanOnTerminal('y', ['rm', '15']);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('Deleted #15.');

  await expect(panel(page)).toContainText('Select a card to see its details.');
  await expect(card(page, 15)).toHaveCount(0);
  await expect(page.getByRole('contentinfo')).toContainText('8 cards');
});
