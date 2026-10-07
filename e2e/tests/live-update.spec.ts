import { expect, test, type Page } from '@playwright/test';
import { agboardOk, mainProject, nextCardId, resetBoard } from '../helpers/agboard';

// Card IDs are never reused, so the first card a test creates gets the number that is next after the reset.
let fresh = 0;

test.beforeEach(async ({ page }) => {
  resetBoard(mainProject);
  fresh = nextCardId(mainProject);
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

test('agboard add shows a new card without reloading', async ({ page }) => {
  agboardOk(mainProject, ['add', 'Added while open', '--desc', 'From the CLI']);
  await expect(lane(page, 'Todo').getByRole('button', { name: new RegExp(`^#${fresh} AI Added while open Updated \\d\\d\\/\\d\\d \\d\\d:\\d\\d$`) })).toBeVisible();
  await expect(page.getByRole('contentinfo')).toContainText('9 cards');
  await expect(lane(page, 'Todo').getByText('4', { exact: true })).toBeVisible();
  // New Todo cards go to the end.
  await expect(lane(page, 'Todo').getByRole('button').last()).toHaveText(new RegExp(`^#${fresh}(?!\\d)`));
  await notReloaded(page);
});

test('agboard mv moves a card without reloading', async ({ page }) => {
  agboardOk(mainProject, ['mv', '16', 'doing']);
  await expect(lane(page, 'Doing').getByRole('button', { name: /^#16 AI Idle Refine the empty board / })).toBeVisible();
  await expect(lane(page, 'Todo').getByRole('button')).toHaveCount(2);
  await expect(lane(page, 'Doing').getByRole('button')).toHaveCount(4);

  // A card finished just now goes to the top of Done.
  agboardOk(mainProject, ['mv', '16', 'done']);
  await expect(lane(page, 'Done').getByRole('button').first()).toHaveText(/^#16(?!\d)/);
  await expect(lane(page, 'Done').getByRole('button')).toHaveCount(3);
  await notReloaded(page);
});

test('dragging a card opens the reason dialog before moving it', async ({ page }) => {
  const source = await card(page, 16).boundingBox();
  const target = await lane(page, 'Doing').boundingBox();
  if (!source || !target) throw new Error('Could not measure the drag source and target.');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 24, source.y + source.height / 2, { steps: 4 });
  await page.mouse.move(target.x + 100, target.y + 100, { steps: 12 });
  await page.mouse.up();
  const move = page.getByRole('dialog');
  await expect(move).toContainText('Todo');
  await expect(move).toContainText('Doing');
  // dnd-kit keeps the source in a dropping animation briefly after pointer-up.
  // Wait until that transition is finished before editing the newly opened dialog.
  // The open dialog makes the board inert, so the card is located by CSS rather than by role.
  const dragged = page.locator('button.card').filter({ hasText: /^#16(?!\d)/ }).first();
  await expect(dragged).not.toHaveAttribute('data-dnd-dragging', 'true');
  await expect(dragged).not.toHaveAttribute('data-dnd-dropping', '');
  await move.getByLabel('Reason').fill('Move after reviewing the board.');
  const moveResponse = page.waitForResponse(
    (response) => response.url().endsWith('/cards/16/move') && response.request().method() === 'POST',
  );
  await move.getByRole('button', { name: 'Move', exact: true }).click();
  const response = await moveResponse;
  expect(response.status(), await response.text()).toBe(200);
  await expect(move).toBeHidden();

  await expect(lane(page, 'Doing').getByRole('button', { name: /^#16 AI Idle Refine the empty board / })).toBeVisible();
  await card(page, 16).click();
  const detail = page.getByRole('complementary', { name: 'Card details' });
  await detail.getByRole('tab', { name: /^History/ }).click();
  await expect(detail.getByRole('listitem').first()).toContainText('Move after reviewing the board.');
  await notReloaded(page);
});

test('agboard state updates the run state and reason without reloading', async ({ page }) => {
  const doing = lane(page, 'Doing');
  agboardOk(mainProject, ['state', '13', 'running']);
  await expect(doing.getByRole('button', { name: /^#13 AI Running Check the board display / })).toBeVisible();

  agboardOk(mainProject, ['state', '13', 'pending', '--reason', 'Waiting for a review']);
  const pending = doing.getByRole('button', { name: /^#13 AI Pending Check the board display / });
  await expect(pending).toBeVisible();
  await expect(pending).toContainText('Waiting for a review');

  agboardOk(mainProject, ['state', '13', 'idle']);
  await expect(doing.getByRole('button', { name: /^#13 AI Idle Check the board display / })).toBeVisible();
  await expect(doing.getByText('Waiting for a review')).toHaveCount(0);
  await notReloaded(page);
});

test('the selection stays on a card that moves to another lane', async ({ page }) => {
  await card(page, 11).click();
  const panel = page.getByRole('complementary', { name: 'Card details' });
  await expect(panel).toContainText('Running');
  await expect(panel).toContainText('Doing');

  agboardOk(mainProject, ['mv', '11', 'done']);
  await expect(lane(page, 'Done').getByRole('button').first()).toHaveText(/^#11(?!\d)/);
  await expect(card(page, 11)).toHaveAttribute('aria-current', 'true');
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Implement card moves');
  await expect(panel).toContainText('Done');
  // It left Doing, so the current status row no longer shows its fixed Idle state.
  await expect(panel.locator('.detail__meta .status-label--agent')).toHaveCount(0);
  await panel.getByRole('tab', { name: /^History/ }).click();
  await expect(panel.getByRole('listitem').first()).toContainText('E2E user action');
  await notReloaded(page);
});

test('users can add a card, choose its owner, and move it with a reason', async ({ page }) => {
  await page.getByRole('button', { name: 'Add card' }).click();
  const create = page.getByRole('dialog', { name: 'Add card' });
  await expect(create.getByRole('radio', { name: 'AI', exact: true })).toBeChecked();
  await expect(create.getByRole('radio', { name: 'User', exact: true })).not.toBeChecked();
  await create.getByRole('textbox', { name: 'Title' }).fill('Review the release notes');
  await create.getByRole('textbox', { name: 'Description (Markdown)' }).fill('Check the wording with the release owner.');
  await create.getByRole('radio', { name: 'User' }).check();
  await create.getByRole('button', { name: 'Add', exact: true }).click();

  const userCard = lane(page, 'Todo').getByRole('button', { name: new RegExp(`^#${fresh} User Review the release notes `) });
  await expect(userCard).toBeVisible();
  await userCard.click();
  const panel = page.getByRole('complementary', { name: 'Card details' });
  await expect(panel.locator('.detail__meta').getByRole('img', { name: 'User', exact: true })).toBeVisible();
  await expect(panel.locator('select')).toHaveCount(0);
  const source = await userCard.boundingBox();
  const target = await lane(page, 'Doing').boundingBox();
  if (!source || !target) throw new Error('Could not measure the drag source and target.');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 24, source.y + source.height / 2, { steps: 4 });
  await page.mouse.move(target.x + 100, target.y + 100, { steps: 12 });
  await page.mouse.up();
  const draggedCard = page.locator('button.card').filter({ hasText: new RegExp(`^#${fresh}(?!\\d)`) }).first();
  await expect(draggedCard).not.toHaveAttribute('data-dnd-dragging', 'true');
  await expect(draggedCard).not.toHaveAttribute('data-dnd-dropping', '');

  const move = page.getByRole('dialog');
  await expect(move).toContainText('Todo');
  await expect(move).toContainText('Doing');
  await move.getByLabel('Reason').fill('The user is starting review now.');
  await move.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(lane(page, 'Doing').getByRole('button', { name: new RegExp(`^#${fresh} User Review the release notes `) })).toBeVisible();
  await panel.getByRole('tab', { name: /^History/ }).click();
  await expect(panel.getByRole('listitem').first()).toContainText('The user is starting review now.');
  await expect(panel.getByRole('listitem').first().getByRole('img', { name: 'User', exact: true })).toBeVisible();
});

test('a user answer returns a pending card to idle and records the full answer in history', async ({ page }) => {
  await card(page, 12).click();
  const panel = page.getByRole('complementary', { name: 'Card details' });
  // The newest event put the card to Pending, so its dot has the Pending color.
  await panel.getByRole('tab', { name: /^History/ }).click();
  await expect(panel.locator('.history__step .dot').first()).toHaveAttribute('data-column', 'doing');
  await expect(panel.locator('.history__step .dot').first()).toHaveAttribute('data-tone', 'pending');
  await expect(panel.locator('.history__step .dot').first()).toHaveCSS('background-color', 'rgb(217, 101, 11)');
  // The request above the tabs takes the answer in place, with no dialog, while the history stays readable.
  await panel.getByRole('button', { name: 'Answer' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const fullAnswer = 'Keep the current database name.\nDo not migrate or delete user data.';
  await panel.getByRole('textbox', { name: 'Your answer' }).fill(fullAnswer);
  await panel.getByRole('button', { name: 'Send', exact: true }).click();

  await expect(lane(page, 'Doing').getByRole('button', { name: /^#12 AI Idle Restore a board from JSON / })).toBeVisible();
  await expect(panel.getByRole('listitem').first().getByRole('img', { name: 'User', exact: true })).toBeVisible();
  await expect(panel.getByRole('listitem').first()).toContainText('Do not migrate or delete user data.');
  await expect(panel.getByRole('button', { name: 'Answer' })).toHaveCount(0);
  // The answer returned the run state to Idle: the new first dot has the Idle color.
  await expect(panel.locator('.history__step .dot').first()).toHaveAttribute('data-tone', 'idle');
  await expect(panel.locator('.history__step .dot').first()).toHaveCSS('background-color', 'rgb(74, 100, 168)');
});
