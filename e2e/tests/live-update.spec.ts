import { expect, test, type Page } from '@playwright/test';
import { resetBoard, skanOk } from '../helpers/skan';

test.beforeEach(async ({ page }) => {
  resetBoard();
  await page.goto('/');
  await expect(page.getByRole('contentinfo').getByRole('status')).toHaveText(/^Synced/);
  // A marker that a reload would wipe: every change below must arrive without one.
  await page.evaluate(() => {
    (window as unknown as { __opened: boolean }).__opened = true;
  });
});

const lane = (page: Page, name: 'Todo' | 'Doing' | 'Done') => page.getByRole('region', { name });
const card = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });

async function notReloaded(page: Page): Promise<void> {
  expect(
    await page.evaluate(() => (window as unknown as { __opened?: boolean }).__opened),
  ).toBe(true);
}

test('skan add shows a new card without reloading', async ({ page }) => {
  skanOk(['add', 'Added while open', '--desc', 'From the CLI']);
  await expect(lane(page, 'Todo').getByRole('button', { name: /^#17 Added while open Updated \d\d\/\d\d \d\d:\d\d$/ })).toBeVisible();
  await expect(page.getByRole('contentinfo')).toContainText('9 cards');
  await expect(lane(page, 'Todo').getByText('4', { exact: true })).toBeVisible();
  // New Todo cards go to the end.
  await expect(lane(page, 'Todo').getByRole('button').last()).toHaveText(/^#17(?!\d)/);
  await notReloaded(page);
});

test('skan mv moves a card to another lane without reloading', async ({ page }) => {
  skanOk(['mv', '16', 'doing']);
  await expect(lane(page, 'Doing').getByRole('button', { name: /^#16 Idle Refine the empty board / })).toBeVisible();
  await expect(lane(page, 'Todo').getByRole('button')).toHaveCount(2);
  await expect(lane(page, 'Doing').getByRole('button')).toHaveCount(4);

  // A card finished just now goes to the top of Done.
  skanOk(['mv', '16', 'done']);
  await expect(lane(page, 'Done').getByRole('button').first()).toHaveText(/^#16(?!\d)/);
  await expect(lane(page, 'Done').getByRole('button')).toHaveCount(3);
  await notReloaded(page);
});

test('skan state updates the run state and the reason without reloading', async ({ page }) => {
  const doing = lane(page, 'Doing');
  skanOk(['state', '13', 'running']);
  await expect(doing.getByRole('button', { name: /^#13 Running Check the board display / })).toBeVisible();

  skanOk(['state', '13', 'pending', '--reason', 'Waiting for a review']);
  const pending = doing.getByRole('button', { name: /^#13 Pending Check the board display / });
  await expect(pending).toBeVisible();
  await expect(pending).toContainText('Waiting for a review');

  skanOk(['state', '13', 'idle']);
  await expect(doing.getByRole('button', { name: /^#13 Idle Check the board display / })).toBeVisible();
  await expect(doing.getByText('Waiting for a review')).toHaveCount(0);
  await notReloaded(page);
});

test('the selection stays on a card that moves to another lane', async ({ page }) => {
  await card(page, 11).click();
  const panel = page.getByRole('complementary', { name: 'Card details' });
  await expect(panel).toContainText('Running');
  await expect(panel).toContainText('Doing');

  skanOk(['mv', '11', 'done']);
  await expect(lane(page, 'Done').getByRole('button').first()).toHaveText(/^#11(?!\d)/);
  await expect(card(page, 11)).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Implement card moves');
  await expect(panel).toContainText('Done');
  // It left Doing, so it is idle and shows no run state.
  await expect(panel.getByText(/^(Idle|Running|Pending)$/)).toHaveCount(0);
  await expect(panel.getByRole('listitem')).toHaveCount(3);
  await notReloaded(page);
});
