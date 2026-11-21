import { expect, test, type Page } from '../helpers/fixtures';
import { agboardOk, mainProject, nextTaskId, resetBoard, taskBody, askArgs, decisionJson } from '../helpers/agboard';
import { readBoardAfterReset, waitForDrop } from '../helpers/ui';
import { openAnswer, sendAnswer } from '../helpers/answer';
import { closeMessages } from '../helpers/answer-flow';

// Card IDs are never reused, so the first card a test creates gets the number that is next after the reset.
let fresh = 0;

test.beforeEach(async ({ page }) => {
  resetBoard(mainProject);
  fresh = nextTaskId(mainProject);
  await page.goto('/');
  await expect(page.getByRole('contentinfo').getByRole('status')).toHaveText(/^Synced/);
  await readBoardAfterReset(page);
  // A marker that a reload would wipe: every change below must arrive without one.
  await page.evaluate(() => {
    (window as unknown as { __opened: boolean }).__opened = true;
  });
});

const lane = (page: Page, name: 'Todo' | 'Doing' | 'Done') => page.getByRole('region', { name });
const task = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });

async function dragToLane(
  page: Page,
  id: number,
  targetLane: 'Todo' | 'Doing' | 'Done',
  sourceLane: 'Todo' | 'Doing' | 'Done' = 'Todo',
): Promise<void> {
  const sourceTask = lane(page, sourceLane).getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });
  await expect(sourceTask).toBeVisible();
  const source = await sourceTask.boundingBox();
  const target = await lane(page, targetLane).boundingBox();
  if (!source || !target) throw new Error('Could not measure the drag source and target.');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 24, source.y + source.height / 2, { steps: 4 });
  await page.mouse.move(target.x + 100, target.y + 100, { steps: 12 });
  await page.mouse.up();
  await waitForDrop(page);
}

async function notReloaded(page: Page): Promise<void> {
  expect(
    await page.evaluate(() => (window as unknown as { __opened?: boolean }).__opened),
  ).toBe(true);
}

test('agboard add shows a new task without reloading', async ({ page }) => {
  agboardOk(mainProject, ['add', 'Added while open', `--desc=From the CLI`]);
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

test('dragging a task moves it at once, with no dialog and a generated reason', async ({ page }) => {
  const moveResponse = page.waitForResponse(
    (response) => response.url().endsWith('/tasks/16/move') && response.request().method() === 'POST',
  );
  await dragToLane(page, 16, 'Doing');
  const response = await moveResponse;
  expect(response.status(), await response.text()).toBe(200);
  expect(JSON.parse(response.request().postData() ?? '{}')).toEqual({ taskStatus: 'doing', fromStatus: 'todo' });
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await expect(lane(page, 'Doing').getByRole('button', { name: /^#16 AI Idle Refine the empty board / })).toBeVisible();
  await task(page, 16).click();
  const detail = page.getByRole('complementary', { name: 'Task details' });
  await detail.getByRole('tab', { name: /^History/ }).click();
  await expect(detail.getByRole('listitem').first()).toContainText('Moved task from Todo to Doing');
  await notReloaded(page);
});

// #679: every single-card lane move shows in its target lane before the server answers, and a refusal puts it back.
for (const viewport of [{ width: 1280, height: 900 }, { width: 800, height: 900 }]) {
  test(`a drag between Todo, Doing and Done shows at once, at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/projects/*/tasks/16/move', async (route) => {
      await gate;
      await route.continue();
    });
    await dragToLane(page, 16, 'Doing');
    // The request is held, and the card is already in Doing.
    await expect(lane(page, 'Doing').getByRole('button', { name: /^#16 / })).toBeVisible();
    await expect(lane(page, 'Todo').getByRole('button', { name: /^#16 / })).toHaveCount(0);
    expect(JSON.parse(agboardOk(mainProject, ['show', '16', '--json']).stdout).task.taskStatus).toBe('todo');
    release();
    await expect.poll(() => JSON.parse(agboardOk(mainProject, ['show', '16', '--json']).stdout).task.taskStatus).toBe('doing');
    await expect(lane(page, 'Doing').getByRole('button', { name: /^#16 / })).toBeVisible();
    await expect(page.locator('.transient-notice')).toHaveCount(0);

    // Doing -> Done, held again.
    let releaseDone: () => void = () => {};
    const doneGate = new Promise<void>((resolve) => (releaseDone = resolve));
    await page.unroute('**/api/projects/*/tasks/16/move');
    await page.route('**/api/projects/*/tasks/16/move', async (route) => {
      await doneGate;
      await route.continue();
    });
    await dragToLane(page, 16, 'Done', 'Doing');
    await expect(lane(page, 'Done').getByRole('button', { name: /^#16 / })).toBeVisible();
    await expect(lane(page, 'Doing').getByRole('button', { name: /^#16 / })).toHaveCount(0);
    expect(JSON.parse(agboardOk(mainProject, ['show', '16', '--json']).stdout).task.taskStatus).toBe('doing');
    releaseDone();
    await expect.poll(() => JSON.parse(agboardOk(mainProject, ['show', '16', '--json']).stdout).task.taskStatus).toBe('done');
    await expect(lane(page, 'Done').getByRole('button', { name: /^#16 / })).toBeVisible();
    await notReloaded(page);
  });

  test(`a refused drag puts the card back and says so, at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route('**/api/projects/*/tasks/16/move', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { reason: 'The move was refused.' } }) }),
    );
    await dragToLane(page, 16, 'Doing');
    await expect(page.locator('.transient-notice')).toHaveText('Could not move the task. It stays where it was.');
    await expect(lane(page, 'Todo').getByRole('button', { name: /^#16 / })).toBeVisible();
    await expect(lane(page, 'Doing').getByRole('button', { name: /^#16 / })).toHaveCount(0);
    expect(JSON.parse(agboardOk(mainProject, ['show', '16', '--json']).stdout).task.taskStatus).toBe('todo');
  });
}

test('a move after an external lane change is refused, the card returns to its lane, and a notice says so', async ({ page }) => {
  const before = JSON.parse(agboardOk(mainProject, ['show', '16', '--json']).stdout).task.history.length;
  // The page still shows #16 in Todo when the CLI moves it to Done. The page's move starts from Todo, so
  // the server refuses it, writes nothing, and names where the task is now.
  await page.route('**/api/projects/*/tasks/16/move', async (route) => {
    agboardOk(mainProject, ['mv', '16', 'done', '--actor', 'human']);
    await route.continue();
  });
  await dragToLane(page, 16, 'Doing');
  await expect(page.locator('.transient-notice')).toContainText('This task was moved by another change, so it was not moved. It is now in Done.');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(lane(page, 'Done').getByRole('button', { name: /^#16 / })).toBeVisible();
  await expect(lane(page, 'Doing').getByRole('button', { name: /^#16 / })).toHaveCount(0);
  expect(JSON.parse(agboardOk(mainProject, ['show', '16', '--json']).stdout).task.history).toHaveLength(before + 1);
  await notReloaded(page);
});

test('agboard state and the question it waits on update the run state without reloading', async ({ page }) => {
  const doing = lane(page, 'Doing');
  agboardOk(mainProject, ['state', '13', 'running']);
  await expect(doing.getByRole('button', { name: /^#13 AI Running Check the board display / })).toBeVisible();

  const asked = JSON.parse(agboardOk(mainProject, ['--json', ...askArgs('13', decisionJson('Waiting for a review'))]).stdout.split('\n')[0]);
  const pending = doing.getByRole('button', { name: /^#13 AI Pending Check the board display / });
  await expect(pending).toBeVisible();
  // The card offers the button only; the question is read in the dialog.
  await expect(doing.getByText('Waiting for a review')).toHaveCount(0);
  await expect(await openAnswer(page, 13)).toContainText('Waiting for a review');
  await page.keyboard.press('Escape');

  // Pending comes from the open question, so the wait ends when the question is withdrawn.
  agboardOk(mainProject, ['message', 'withdraw', asked.questions[0].id, '--actor', 'ai']);
  await expect(doing.getByRole('button', { name: /^#13 AI Idle Check the board display / })).toBeVisible();
  await expect(doing.getByText('Waiting for a review')).toHaveCount(0);
  await notReloaded(page);
});

test('an open task follows its move to another lane while its details stay open', async ({ page }) => {
  await task(page, 11).click();
  const panel = page.getByRole('complementary', { name: 'Task details' });
  await expect(panel).toContainText('Running');
  await expect(panel).toContainText('Doing');

  // The details panel does not hold the stream's updates back: the card moves and stays selected.
  agboardOk(mainProject, ['mv', '11', 'done']);
  await expect(lane(page, 'Done').locator('.lane__cards').getByRole('button').first()).toHaveText(/^#11(?!\d)/, { timeout: 5_000 });
  await expect(task(page, 11)).toHaveAttribute('aria-current', 'true');
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Implement task moves');
  await expect(panel).toContainText('Done');
  // It left Doing, so the current status row no longer shows its fixed Idle state.
  await expect(panel.locator('.detail__meta .status-label--agent')).toHaveCount(0);
  await panel.getByRole('tab', { name: /^History/ }).click();
  await expect(panel.getByRole('listitem').first()).toContainText('Moved task from Doing to Done; agent is idle.');
  await notReloaded(page);
});

test('a task for the user added from the CLI appears live and moves with a generated reason', async ({ page }) => {
  agboardOk(mainProject, ['add', 'Review the release notes', '--assignee', 'human', '--actor', 'human', `--desc=${taskBody('Check the wording with the release owner.')}`]);

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
  await waitForDrop(page);

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(lane(page, 'Doing').getByRole('button', { name: new RegExp(`^#${fresh} User Review the release notes `) })).toBeVisible();
  await panel.getByRole('tab', { name: /^History/ }).click();
  await expect(panel.getByRole('listitem').first()).toContainText('Moved task from Todo to Doing');
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
  await expect(panel.locator('.history__reason .md').first()).toHaveCSS('color', 'rgb(86, 98, 116)');
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
  // The request stays read-only in details; the response is entered in the card's answer dialog.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const fullAnswer = 'Keep the current database name.\nDo not migrate or delete user data.';
  await sendAnswer(page, 12, { choice: 'Keep compatibility (recommended)', text: fullAnswer });
  await closeMessages(page);

  await expect(lane(page, 'Doing').getByRole('button', { name: /^#12 AI Idle Restore a board from JSON / })).toBeVisible();
  await expect(panel.getByRole('listitem').first().getByRole('img')).toHaveCount(0);
  await expect(panel.getByRole('listitem').first()).toContainText('Do not migrate or delete user data.');
  await expect(panel.getByRole('region', { name: 'The agent is waiting for your answer' })).toHaveCount(0);
  // The new answer note keeps the same neutral timeline tone.
  await expect(panel.locator('.history__step .dot').first()).toHaveAttribute('data-tone', 'idle');
  await expect(panel.locator('.history__step .dot').first()).toHaveCSS('background-color', 'rgb(133, 144, 161)');
});
