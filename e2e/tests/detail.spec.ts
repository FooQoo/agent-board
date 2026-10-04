import { expect, test, type Page } from '@playwright/test';
import { resetBoard } from '../helpers/agboard';

test.beforeEach(async ({ page }) => {
  resetBoard();
  await page.goto('/');
  await expect(page.getByRole('contentinfo').getByRole('status')).toHaveText(/^Synced/);
});

const details = (page: Page) => page.getByRole('complementary', { name: 'Card details' });
const card = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });

test('with no card selected the panel shows a hint', async ({ page }) => {
  await expect(details(page)).toContainText('Select a card to see its details.');
  await expect(details(page).getByRole('button', { name: 'Close details' })).toHaveCount(0);
  await expect(details(page).getByRole('button', { name: 'Delete card' })).toHaveCount(0);
});

test('selecting a card shows its column, state, and description with line breaks', async ({ page }) => {
  await card(page, 13).click();
  const panel = details(page);
  await expect(panel).toContainText('#13');
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Check the board display');
  await expect(panel).toContainText('Doing');
  await expect(panel).toContainText('Idle');
  await expect(panel.getByRole('heading', { name: 'Description' })).toBeVisible();
  await expect(card(page, 13)).toHaveAttribute('aria-current', 'true');

  // The description is shown as written, with its line break.
  const description = panel.getByText('Check the layout at 1280, 800, and 480 px.');
  expect(await description.evaluate((element) => (element as HTMLElement).innerText)).toBe(
    'Check the layout at 1280, 800, and 480 px.\nLook for horizontal scrolling.',
  );
  const lineHeight = await description.evaluate((element) => parseFloat(getComputedStyle(element).lineHeight));
  expect((await description.boundingBox())!.height).toBeGreaterThan(lineHeight * 1.5);
});

test('the panel shows the run state and the reason for Doing cards, and an empty description', async ({
  page,
}) => {
  const panel = details(page);

  await card(page, 12).click();
  await expect(panel).toContainText('Pending');
  await expect(panel).toContainText('Waiting for confirmation on how to replace a board.');
  await expect(panel).toContainText('No description.');

  await card(page, 11).click();
  await expect(panel).toContainText('Running');
  await expect(panel).not.toContainText('Waiting for confirmation');

  // A card outside Doing has a column and no run state.
  await card(page, 8).click();
  await expect(panel).toContainText('Done');
  await expect(panel.getByText(/^(Idle|Running|Pending)$/)).toHaveCount(0);
});

test('History shows the newest status change first with its actor and reason', async ({
  page,
}) => {
  await card(page, 8).click();
  const history = details(page).getByRole('list');
  await expect(history.getByRole('listitem')).toHaveText([
    /^DoneAI10\/02 09:48Moved card$/,
    /^DoingAI10\/01 16:30Moved card$/,
    /^TodoAICreated · 10\/01 16:00$/,
  ]);
  await expect(history.getByText('Created')).toHaveCount(1);
  await expect(details(page).getByRole('heading', { name: 'History' })).toBeVisible();

  await card(page, 14).click();
  await expect(history.getByRole('listitem')).toHaveText([/^TodoAICreated · 10\/02 03:00$/]);
});

test('selecting another card switches the panel, and Close details clears it', async ({ page }) => {
  const panel = details(page);
  await card(page, 8).click();
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Initialize the board');

  await card(page, 9).click();
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Return the card list as JSON');
  await expect(card(page, 8)).toHaveAttribute('aria-current', 'false');
  await expect(card(page, 9)).toHaveAttribute('aria-current', 'true');

  await panel.getByRole('button', { name: 'Close details' }).click();
  await expect(panel).toContainText('Select a card to see its details.');
  await expect(card(page, 9)).toHaveAttribute('aria-current', 'false');
  await expect(panel.getByRole('heading', { level: 2 })).toHaveCount(0);
});

test('opening, switching, and closing the panel never moves the board', async ({ page }) => {
  const board = page.getByRole('main');
  const probes = [11, 12, 14, 9];
  const measure = async () => ({
    board: await board.boundingBox(),
    cards: await Promise.all(probes.map((id) => card(page, id).boundingBox())),
    todo: await page.getByRole('region', { name: 'Todo' }).boundingBox(),
  });

  const initial = await measure();
  expect(initial.board!.width).toBeGreaterThan(0);

  for (const id of [11, 12, 8]) {
    await card(page, id).click();
    await expect(card(page, id)).toHaveAttribute('aria-current', 'true');
    expect(await measure()).toEqual(initial);
  }
  await details(page).getByRole('button', { name: 'Close details' }).click();
  await expect(details(page)).toContainText('Select a card to see its details.');
  expect(await measure()).toEqual(initial);
});

test('the card grips never take keyboard focus', async ({ page }) => {
  // With nothing selected, Tab visits Add card, the language control, and eight cards; grips stay out of the order.
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const visited: string[] = [];
  for (let step = 0; step < 10; step++) {
    await page.keyboard.press('Tab');
    visited.push(
      await page.evaluate(() => {
        const active = document.activeElement as HTMLElement;
        const cardId = (active.textContent ?? '').match(/^#\d+/)?.[0];
        return `${active.tagName} ${active.getAttribute('aria-label') ?? cardId ?? active.textContent}`;
      }),
    );
  }
  expect(visited).toEqual([
    'BUTTON Add card',
    'BUTTON Language',
    'BUTTON #14',
    'BUTTON #15',
    'BUTTON #16',
    'BUTTON #11',
    'BUTTON #12',
    'BUTTON #13',
    'BUTTON #9',
    'BUTTON #8',
  ]);

  // The detail panel exposes its close and delete actions; the grip itself never receives focus.
  await card(page, 8).click();
  await page.keyboard.press('Tab');
  await expect(details(page).getByRole('button', { name: 'Close details' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(details(page).getByRole('button', { name: 'Delete card' })).toBeFocused();

  // Interactive controls can be focused, while icon grips are never independent tab stops.
  const focusable = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')]
      .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled'))
      .map((element) => (element.textContent ?? '').trim().slice(0, 3) || element.getAttribute('aria-label')),
  );
  expect(focusable).toHaveLength(1 + 1 + 8 + 2);
  expect(await page.locator('.grip').evaluateAll((elements) => elements.every((element) => (element as HTMLElement).tabIndex < 0))).toBe(true);
});
