import { expect, test, type Page } from '@playwright/test';
import { agboardOk, mainProject, nextTaskId, resetBoard, taskBody, decisionJson } from '../helpers/agboard';
import { openManualCreateDialog, pasteMarkdown } from '../helpers/ui';

// Card IDs are never reused, so the first card a test creates gets the number that is next after the reset.
let fresh = 0;

test.beforeEach(async ({ page }) => {
  resetBoard(mainProject);
  fresh = nextTaskId(mainProject);
  await page.goto('/');
  await expect(page.getByRole('contentinfo').getByRole('status')).toHaveText(/^Synced/);
  // A marker that a reload would wipe: every change below must arrive without one.
  await page.evaluate(() => {
    (window as unknown as { __opened: boolean }).__opened = true;
  });
});

const lane = (page: Page, name: 'Todo' | 'Doing' | 'Done') => page.getByRole('region', { name });
const task = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });

async function dragToLane(page: Page, id: number, targetLane: 'Todo' | 'Doing' | 'Done'): Promise<void> {
  const sourceTask = lane(page, 'Todo').getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });
  await expect(sourceTask).toBeVisible();
  const source = await sourceTask.boundingBox();
  const target = await lane(page, targetLane).boundingBox();
  if (!source || !target) throw new Error('Could not measure the drag source and target.');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 24, source.y + source.height / 2, { steps: 4 });
  await page.mouse.move(target.x + 100, target.y + 100, { steps: 12 });
  await page.mouse.up();
}

async function notReloaded(page: Page): Promise<void> {
  expect(
    await page.evaluate(() => (window as unknown as { __opened?: boolean }).__opened),
  ).toBe(true);
}

test('agboard add shows a new task without reloading', async ({ page }) => {
  agboardOk(mainProject, ['add', 'Added while open', '--desc', 'From the CLI']);
  await expect(lane(page, 'Todo').getByRole('button', { name: new RegExp(`^#${fresh} AI Added while open Updated \\d\\d\\/\\d\\d \\d\\d:\\d\\d$`) })).toBeVisible();
  await expect(page.getByRole('contentinfo')).toContainText('9 tasks');
  await expect(lane(page, 'Todo').getByText('4', { exact: true })).toBeVisible();
  // New Todo cards go to the end.
  await expect(lane(page, 'Todo').getByRole('button').last()).toHaveText(new RegExp(`^#${fresh}(?!\\d)`));
  await notReloaded(page);
});

test('agboard mv moves a task without reloading', async ({ page }) => {
  agboardOk(mainProject, ['mv', '16', 'doing']);
  await expect(lane(page, 'Doing').getByRole('button', { name: /^#16 AI Idle Refine the empty board / })).toBeVisible();
  await expect(lane(page, 'Todo').locator('.lane__cards .card')).toHaveCount(2);
  await expect(lane(page, 'Doing').locator('.lane__cards .card')).toHaveCount(4);

  // A card finished just now goes to the top of Done.
  agboardOk(mainProject, ['mv', '16', 'done']);
  await expect(lane(page, 'Done').locator('.lane__cards').getByRole('button').first()).toHaveText(/^#16(?!\d)/);
  await expect(lane(page, 'Done').locator('.lane__cards .card')).toHaveCount(3);
  await notReloaded(page);
});

test('dragging a task opens the reason dialog before moving it', async ({ page }) => {
  await dragToLane(page, 16, 'Doing');
  const move = page.getByRole('dialog');
  await expect(move).toContainText('Todo');
  await expect(move).toContainText('Doing');
  // dnd-kit keeps the source in a dropping animation briefly after pointer-up.
  // Wait until that transition is finished before editing the newly opened dialog.
  // The open dialog makes the board inert, so the card is located by CSS rather than by role.
  const dragged = page.locator('.card').filter({ hasText: /^#16(?!\d)/ }).first();
  await expect(dragged).not.toHaveClass(/card--dragging/);
  await move.getByLabel('Reason').fill('Move after reviewing the board.');
  await expect(move.getByLabel('Reason')).toHaveValue('Move after reviewing the board.');
  const moveResponse = page.waitForResponse(
    (response) => response.url().endsWith('/tasks/16/move') && response.request().method() === 'POST',
  );
  await move.getByRole('button', { name: 'Move', exact: true }).click();
  const response = await moveResponse;
  expect(response.status(), await response.text()).toBe(200);
  await expect(move).toBeHidden();

  await expect(lane(page, 'Doing').getByRole('button', { name: /^#16 AI Idle Refine the empty board / })).toBeVisible();
  await task(page, 16).click();
  const detail = page.getByRole('complementary', { name: 'Task details' });
  await detail.getByRole('tab', { name: /^History/ }).click();
  await expect(detail.getByRole('listitem').first()).toContainText('Move after reviewing the board.');
  await notReloaded(page);
});

test('confirming a move after an external lane change keeps exactly one task and records the current transition', async ({ page }) => {
  await dragToLane(page, 16, 'Doing');
  const move = page.getByRole('dialog');
  const reason = move.getByRole('textbox', { name: 'Reason (optional)' });
  await expect(reason).toHaveValue('');
  await expect(page.locator('.card--dragging')).toHaveCount(0);
  agboardOk(mainProject, ['mv', '16', 'done', '--actor', 'human']);
  await expect(move.getByRole('group', { name: 'Status change' })).toContainText('Done');
  await expect(move.getByRole('button', { name: 'Move', exact: true })).toBeEnabled();
  await move.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(move).toHaveCount(0);
  await expect(task(page, 16)).toHaveCount(1);
  await expect(lane(page, 'Doing').getByRole('button', { name: /^#16 AI Idle Refine the empty board / })).toBeVisible();
  const stored = JSON.parse(agboardOk(mainProject, ['show', '16', '--json']).stdout).task;
  expect(stored.history.at(-1)).toEqual({ at: expect.any(String), reason: 'User changed the status from Done to Doing.' });
  await notReloaded(page);
});

test('agboard state updates the run state and reason without reloading', async ({ page }) => {
  const doing = lane(page, 'Doing');
  agboardOk(mainProject, ['state', '13', 'running']);
  await expect(doing.getByRole('button', { name: /^#13 AI Running Check the board display / })).toBeVisible();

  agboardOk(mainProject, ['state', '13', 'pending', '--actor', 'ai', '--no-wait', '--request-json', decisionJson('Waiting for a review')]);
  const pending = doing.getByRole('button', { name: /^#13 AI Pending Check the board display / });
  await expect(pending).toBeVisible();
  await expect(doing.locator('.card__answer[data-task-id="13"]')).toContainText('Waiting for a review');

  agboardOk(mainProject, ['state', '13', 'idle']);
  await expect(doing.getByRole('button', { name: /^#13 AI Idle Check the board display / })).toBeVisible();
  await expect(doing.getByText('Waiting for a review')).toHaveCount(0);
  await notReloaded(page);
});

test('the selection stays on a task that moves to another lane', async ({ page }) => {
  await task(page, 11).click();
  const panel = page.getByRole('complementary', { name: 'Task details' });
  await expect(panel).toContainText('Running');
  await expect(panel).toContainText('Doing');

  agboardOk(mainProject, ['mv', '11', 'done']);
  await expect(lane(page, 'Done').locator('.lane__cards').getByRole('button').first()).toHaveText(/^#11(?!\d)/);
  await expect(task(page, 11)).toHaveAttribute('aria-current', 'true');
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Implement task moves');
  await expect(panel).toContainText('Done');
  // It left Doing, so the current status row no longer shows its fixed Idle state.
  await expect(panel.locator('.detail__meta .status-label--agent')).toHaveCount(0);
  await panel.getByRole('tab', { name: /^History/ }).click();
  await expect(panel.getByRole('listitem').first()).toContainText('Moved task from Doing to Done; agent is idle.');
  await notReloaded(page);
});

test('users can add a task, choose its owner, and move it with a reason', async ({ page }) => {
  const create = await openManualCreateDialog(page);
  await expect(create.getByRole('radio', { name: 'AI', exact: true })).toBeChecked();
  await expect(create.getByRole('radio', { name: 'User', exact: true })).not.toBeChecked();
  await create.getByRole('textbox', { name: 'Title' }).fill('Review the release notes');
  await pasteMarkdown(create.getByRole('textbox', { name: 'Description (Markdown)' }), taskBody('Check the wording with the release owner.'));
  await create.getByRole('radio', { name: 'User' }).check();
  await create.getByRole('button', { name: 'Add', exact: true }).click();

  const userTask = lane(page, 'Todo').getByRole('button', { name: new RegExp(`^#${fresh} User Review the release notes `) });
  await expect(userTask).toBeVisible();
  await userTask.click();
  const panel = page.getByRole('complementary', { name: 'Task details' });
  await expect(panel.locator('.detail__meta').getByRole('img', { name: 'User', exact: true })).toBeVisible();
  await expect(panel.locator('select')).toHaveCount(0);
  const source = await userTask.boundingBox();
  const target = await lane(page, 'Doing').boundingBox();
  if (!source || !target) throw new Error('Could not measure the drag source and target.');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 24, source.y + source.height / 2, { steps: 4 });
  await page.mouse.move(target.x + 100, target.y + 100, { steps: 12 });
  await page.mouse.up();
  const draggedTask = page.locator('.card').filter({ hasText: new RegExp(`^#${fresh}(?!\\d)`) }).first();
  await expect(draggedTask).not.toHaveClass(/card--dragging/);

  const move = page.getByRole('dialog');
  await expect(move).toContainText('Todo');
  await expect(move).toContainText('Doing');
  await move.getByLabel('Reason').fill('The user is starting review now.');
  await move.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(lane(page, 'Doing').getByRole('button', { name: new RegExp(`^#${fresh} User Review the release notes `) })).toBeVisible();
  await panel.getByRole('tab', { name: /^History/ }).click();
  await expect(panel.getByRole('listitem').first()).toContainText('The user is starting review now.');
  await expect(panel.getByRole('listitem').first().getByRole('img')).toHaveCount(0);
});

test('a user answer returns a pending task to idle and records the full answer in history', async ({ page }) => {
  await task(page, 12).click();
  const panel = page.getByRole('complementary', { name: 'Task details' });
  // All recorded reasons use neutral dots without inferred state tags.
  await panel.getByRole('tab', { name: /^History/ }).click();
  await expect(panel.locator('.history__step .dot').first()).not.toHaveAttribute('data-column');
  await expect(panel.locator('.history__step .dot').first()).toHaveAttribute('data-tone', 'idle');
  await expect(panel.locator('.history__step .dot').first()).toHaveCSS('background-color', 'rgb(133, 144, 161)');
  await expect(panel.locator('.history__reason').first()).toHaveCSS('color', 'rgb(27, 36, 48)');
  await expect(panel.locator('.history__at').first()).toHaveCSS('color', 'rgb(86, 98, 116)');
  expect(await panel.locator('.history__step').first().evaluate((step) => getComputedStyle(step, '::before').backgroundColor)).toBe('rgb(225, 229, 235)');
  // Each dot is centered on the first line of its reason, not on the time above it or below the text.
  for (const step of await panel.locator('.history__step').all()) {
    const dot = await step.locator('.dot').boundingBox();
    const reasonBox = await step.locator('.history__reason').boundingBox();
    const lineHeight = await step.locator('.history__reason').evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
    if (!dot || !reasonBox) throw new Error('history step has no box');
    expect(Math.abs(dot.y + dot.height / 2 - (reasonBox.y + lineHeight / 2))).toBeLessThan(1);
  }
  // The request stays read-only in details; the response is entered on the card with no dialog.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const fullAnswer = 'Keep the current database name.\nDo not migrate or delete user data.';
  const answer = task(page, 12).locator('..').locator('.card__answer');
  await answer.getByRole('textbox', { name: 'Your answer' }).fill(fullAnswer);
  await answer.getByRole('button', { name: 'Send', exact: true }).click();

  await expect(lane(page, 'Doing').getByRole('button', { name: /^#12 AI Idle Restore a board from JSON / })).toBeVisible();
  await expect(panel.getByRole('listitem').first().getByRole('img')).toHaveCount(0);
  await expect(panel.getByRole('listitem').first()).toContainText('Do not migrate or delete user data.');
  await expect(panel.getByRole('region', { name: 'The agent is waiting for your answer' })).toHaveCount(0);
  // The new answer note keeps the same neutral timeline tone.
  await expect(panel.locator('.history__step .dot').first()).toHaveAttribute('data-tone', 'idle');
  await expect(panel.locator('.history__step .dot').first()).toHaveCSS('background-color', 'rgb(133, 144, 161)');
});
