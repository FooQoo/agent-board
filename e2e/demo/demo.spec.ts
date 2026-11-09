import { expect, test, type Locator, type Page } from '@playwright/test';

// The browser demo as GitHub Pages publishes it: the documentation site with the demo build in
// its demo/ folder. The board lives in the page, so every test starts from the sample data and
// the first-run guide.

const lane = (page: Page, name: 'Todo' | 'Doing' | 'Done'): Locator => page.getByRole('region', { name });
const task = (scope: Page | Locator, id: number): Locator =>
  scope.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });
const details = (page: Page): Locator => page.getByRole('complementary', { name: 'Task details' });

/**
 * Opens the demo and waits for the first-run guide, which starts on every page load. Returns the
 * uncaught page errors, which each test expects to stay empty.
 */
async function openDemo(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./');
  await expect(page.getByText('Try Agent Board')).toBeVisible();
  return errors;
}

/** Moves a card with a real drag to another lane and confirms the move dialog. */
async function dragTaskTo(page: Page, id: number, to: 'Todo' | 'Doing' | 'Done'): Promise<void> {
  const source = await task(page, id).boundingBox();
  const target = await lane(page, to).boundingBox();
  if (!source || !target) throw new Error('Could not measure the drag source and target.');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 24, source.y + source.height / 2, { steps: 4 });
  await page.mouse.move(target.x + 100, target.y + 100, { steps: 12 });
  await page.mouse.up();
  const dialog = page.getByRole('dialog', { name: 'Move task' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(dialog).toBeHidden();
}

test('DEMO-01: the guide runs to the end, then a card moves and a checked condition completes another', async ({
  page,
}) => {
  const errors = await openDemo(page);

  // AC-1: the guide plays the AI. It runs one sample card, asks a question on the other,
  // and finishes it after the answer.
  await page.getByRole('button', { name: 'Start guide' }).click();
  await expect(page.getByText('Guide 1 / 4')).toBeVisible();
  await page.getByRole('button', { name: 'Watch it move' }).click();

  await expect(page.getByText('Guide 2 / 4')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('The first card is done')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByText('Guide 3 / 4')).toBeVisible();
  await expect(page.locator('.onboarding-panel__badge')).toHaveText('Waiting for you');
  const stage = page.getByRole('dialog', { name: 'Guide' });
  await stage.getByRole('button', { name: 'Answer the question' }).click();
  const guideAnswer = page.getByRole('dialog').filter({ has: page.getByRole('textbox', { name: 'Note' }) });
  await guideAnswer.getByLabel('Keep it brief').check();
  await guideAnswer.getByRole('button', { name: 'Send', exact: true }).click();

  await expect(page.getByText('Guide 4 / 4')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('You have completed the guide')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Finish and get started' }).click();
  await expect(page.getByText('The two sample tasks have been archived.')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Guide' })).toHaveCount(0);
  await expect(page.locator('main .card').filter({ hasText: 'Sample:' })).toHaveCount(0);

  // AC-2: after the guide the board is free to use. A card moves from Todo to Doing.
  await expect(task(lane(page, 'Todo'), 15)).toBeVisible();
  await dragTaskTo(page, 15, 'Doing');
  await expect(task(lane(page, 'Doing'), 15)).toBeVisible();
  await expect(task(lane(page, 'Todo'), 15)).toHaveCount(0);

  // Card #11 waits for an answer, and a waiting card is not completed. Answer it first.
  const card11 = page.locator('.card__item').filter({ has: task(page, 11) });
  await card11.getByRole('button', { name: 'Answer the question' }).click();
  const answer = page.getByRole('dialog').filter({ has: page.getByRole('textbox', { name: 'Note' }) });
  await answer.getByLabel('Keep the order they were moved in').check();
  await answer.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(answer).toBeHidden();
  await expect(task(lane(page, 'Doing'), 11)).toContainText('Idle');

  // Checking its last two conditions moves the AI card to Done, as `agboard serve` does.
  await task(page, 11).click();
  const panel = details(page);
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Implement task moves');
  await panel.getByRole('tab', { name: 'Conditions' }).click();
  await panel.getByRole('checkbox', { name: 'The history keeps the reason' }).check();
  await expect(task(lane(page, 'Doing'), 11)).toContainText('3/4');
  await panel.getByRole('checkbox', { name: 'A waiting task goes back to idle' }).check();
  await expect(task(lane(page, 'Done'), 11)).toBeVisible();
  await expect(task(lane(page, 'Doing'), 11)).toHaveCount(0);
  await panel.getByRole('tab', { name: /^History/ }).click();
  await expect(panel.getByRole('tabpanel')).toContainText('All acceptance conditions are complete.');
  expect(errors).toEqual([]);
});

test('DEMO-02: skipping the guide shows the board without the features a static site cannot offer', async ({
  page,
}) => {
  const errors = await openDemo(page);
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByText('Try Agent Board')).toBeHidden();
  await expect(task(lane(page, 'Todo'), 15)).toBeVisible();

  // No project Docs: the demo has no files on a computer to open.
  const header = page.getByRole('banner');
  await expect(header.getByRole('button', { name: 'Settings' })).toBeVisible();
  await expect(header.getByRole('button', { name: 'Docs' })).toHaveCount(0);

  // No mobile connection: there is no `agboard serve` for a phone to reach.
  await header.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings.getByRole('region', { name: 'Tutorial' })).toBeVisible();
  await expect(settings.getByText('Mobile connection')).toHaveCount(0);
  await settings.getByRole('button', { name: 'Close' }).click();

  // A reload starts again from the sample data, with the guide offered again.
  await dragTaskTo(page, 15, 'Doing');
  await expect(task(lane(page, 'Doing'), 15)).toBeVisible();
  await page.reload();
  await expect(page.getByText('Try Agent Board')).toBeVisible();
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(task(lane(page, 'Todo'), 15)).toBeVisible();
  expect(errors).toEqual([]);
});
