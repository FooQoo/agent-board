import { expect, test, type Page } from '@playwright/test';
import { agboardOk, agboardOnTerminal, listCards, mainProject, nextCardId, resetBoard } from '../helpers/agboard';

// Card IDs are never reused, so the disposable card gets whatever number is next after the reset.
let disposable: number;
let ask: string;

test.beforeEach(async ({ page }) => {
  resetBoard(mainProject);
  disposable = nextCardId(mainProject);
  ask = `Delete #${disposable} "Disposable card"? This cannot be undone.`;
  agboardOk(mainProject, ['add', 'Disposable card', '--desc', 'Delete me']);
  await page.goto('/');
  await expect(page.getByRole('contentinfo').getByRole('status')).toHaveText(/^Synced/);
});

const panel = (page: Page) => page.getByRole('complementary', { name: 'Card details' });
const card = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });

test('Cancel closes the confirmation and keeps the card', async ({ page }) => {
  await card(page, disposable).click();
  await panel(page).getByRole('button', { name: 'Delete card' }).click();

  const confirm = panel(page).getByRole('group', { name: ask });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText(ask);
  await expect(confirm.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();

  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Disposable card');
  await expect(card(page, disposable)).toBeVisible();
  expect(listCards(mainProject).map((c) => c.id)).toContain(disposable);
});

test('Delete removes the card and clears the selection', async ({ page }) => {
  await card(page, disposable).click();
  await panel(page).getByRole('button', { name: 'Delete card' }).click();
  await panel(page).getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(panel(page)).toContainText('Select a card to see its details.');
  await expect(card(page, disposable)).toHaveCount(0);
  await expect(page.getByRole('contentinfo')).toContainText('8 cards');
  expect(listCards(mainProject).map((c) => c.id)).not.toContain(disposable);
  // The numbering goes on; IDs are never reused.
  expect(JSON.parse(agboardOk(mainProject, ['add', 'Next', '--json']).stdout).card.id).toBe(disposable + 1);
});

test('a card the CLI deletes while selected clears the selection', async ({ page }) => {
  await card(page, 15).click();
  await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Write the setup guide');

  // A person at a terminal confirms the deletion with y.
  const result = agboardOnTerminal(mainProject, 'y', ['rm', '15']);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('Deleted #15.');

  await expect(panel(page)).toContainText('Select a card to see its details.');
  await expect(card(page, 15)).toHaveCount(0);
  await expect(page.getByRole('contentinfo')).toContainText('8 cards');
});
