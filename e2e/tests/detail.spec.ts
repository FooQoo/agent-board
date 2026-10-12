import { expect, test, type Page } from '@playwright/test';
import { resetBoard, mainProject } from '../helpers/agboard';

test.beforeEach(async ({ page }) => {
  resetBoard(mainProject);
  await page.goto('/');
  await expect(page.getByRole('contentinfo').getByRole('status')).toHaveText(/^Synced/);
});

const details = (page: Page) => page.getByRole('complementary', { name: 'Card details' });
const card = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });

test('with no card selected the panel shows a hint', async ({ page }) => {
  await expect(details(page)).toContainText('Select a card to see its details.');
  await expect(details(page).getByRole('button', { name: 'Close details' })).toHaveCount(0);
  await expect(details(page).getByRole('button', { name: 'Archive card' })).toHaveCount(0);
});

test('selecting a card shows its column, state, and description with line breaks', async ({ page }) => {
  await card(page, 13).click();
  const panel = details(page);
  await expect(panel).toContainText('#13');
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Check the board display');
  await expect(panel).toContainText('Doing');
  await expect(panel).toContainText('Idle');
  await expect(panel.getByRole('tab', { name: 'Description' })).toHaveAttribute('aria-selected', 'true');
  await expect(card(page, 13)).toHaveAttribute('aria-current', 'true');

  // The description is shown as written, with its line break kept.
  const description = panel.getByRole('tabpanel').getByText('Check the layout at 1280, 800, and 480 px.');
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
  // The pause icon shows on the card and in the detail alike.
  await expect(card(page, 12).locator('.status-label svg')).toHaveCount(1);
  await expect(panel.locator('.detail__meta .status-label--pending svg')).toHaveCount(1);
  // The details show the request read-only; the editable response stays on the card.
  const request = panel.getByRole('region', { name: 'The agent is waiting for your answer' });
  await expect(request).toContainText('Waiting for confirmation on how to replace a board.');
  await expect(request.getByText('Answer on the card.')).toBeVisible();
  const answer = card(page, 12).locator('..').locator('.card__answer');
  // The answer is typed on the card, with no dialog; Cancel clears the draft.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await answer.getByRole('textbox', { name: 'Your answer' }).fill('Typed in place');
  await answer.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(answer.getByRole('textbox', { name: 'Your answer' })).toHaveValue('');
  await expect(answer.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();

  await card(page, 11).click();
  await expect(panel).toContainText('Running');
  await expect(panel).not.toContainText('Waiting for confirmation');
  // The loader turns on the board card only; in the detail it is shown still.
  await expect(card(page, 11).locator('.spinner')).toHaveCSS('animation-name', 'spin');
  await expect(panel.locator('.detail__meta .status-label--running svg')).toHaveCount(1);
  await expect(panel.locator('.detail__meta .status-label--running svg')).toHaveCSS('animation-name', 'none');
  await expect(card(page, 11).locator('.assignee-label svg')).toHaveCount(1);
  await expect(panel.locator('.detail__meta .assignee-label')).toHaveCSS('border-top-style', 'none');

  // A card outside Doing has a column and no run state. Archive is the right end of the toolbar beside the tabs.
  await card(page, 8).click();
  await expect(panel).toContainText('Done');
  const tabsBox = (await panel.getByRole('tablist').boundingBox())!;
  const toolbar = panel.getByRole('toolbar', { name: 'Card actions' });
  const toolbarButtons = toolbar.getByRole('button');
  await expect(toolbarButtons).toHaveText(['Make draft', '']);
  await expect(toolbarButtons.first()).toHaveAttribute('title', 'Make draft');
  await expect(toolbarButtons.first()).toHaveAccessibleName('Make draft');
  await expect(toolbarButtons.last()).toHaveAccessibleName('Archive card');
  // At the default 360px detail width, the longer English label yields to its icon
  // so the tabs and the actions remain on one line.
  const makeDraftBounds = (await toolbarButtons.first().boundingBox())!;
  const toolbarBounds = (await toolbar.boundingBox())!;
  expect(makeDraftBounds.width).toBeGreaterThanOrEqual(29);
  expect(makeDraftBounds.x + makeDraftBounds.width).toBeLessThanOrEqual(toolbarBounds.x + toolbarBounds.width);
  expect(await toolbar.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const archiveBox = (await toolbarButtons.last().boundingBox())!;
  const makeDraftBox = (await toolbarButtons.first().boundingBox())!;
  expect(archiveBox.x).toBeGreaterThan(makeDraftBox.x + makeDraftBox.width - 1);
  expect(Math.abs(archiveBox.y - tabsBox.y)).toBeLessThan(tabsBox.height);
  await expect(panel.getByText(/^(Idle|Running|Pending)$/)).toHaveCount(0);
});

test('History shows the newest status change first with its actor and reason', async ({
  page,
}) => {
  await card(page, 8).click();
  await details(page).getByRole('tab', { name: /^History/ }).click();
  const history = details(page).getByRole('tabpanel').getByRole('list');
  await expect(history.getByRole('listitem')).toHaveText([
    /^10\/02 09:48DoneMoved card$/,
    /^10\/01 16:30DoingMoved card$/,
    /^Created · 10\/01 16:00Todo$/,
  ]);
  await expect(history.getByRole('img', { name: 'AI', exact: true })).toHaveCount(3);
  await expect(history.getByText('Created')).toHaveCount(1);
  await expect(details(page).getByRole('tab', { name: 'History 3' })).toHaveAttribute('aria-selected', 'true');

  // Another card opens on the description again.
  await card(page, 14).click();
  await expect(details(page).getByRole('tab', { name: 'Description' })).toHaveAttribute('aria-selected', 'true');
  await details(page).getByRole('tab', { name: /^History/ }).click();
  await expect(history.getByRole('listitem')).toHaveText([/^Created · 10\/02 03:00Todo$/]);
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
  // The Pending card's answer controls join the tab order; grips stay out of it.
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const visited: string[] = [];
  for (let step = 0; step < 15; step++) {
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
    'BUTTON agent-board',
    'BUTTON Add card',
    'BUTTON Archive',
    'BUTTON Settings',
    'DIV #14',
    'DIV #15',
    'DIV #16',
    'DIV #11',
    'DIV #12',
    'TEXTAREA ',
    'BUTTON Cancel',
    'DIV #13',
    'BUTTON Archive completed cards',
    'DIV #9',
    'DIV #8',
  ]);

  // The detail panel exposes close, the selected tab, and the toolbar actions; the grip itself never receives focus.
  await card(page, 8).click();
  await page.keyboard.press('Tab');
  await expect(details(page).getByRole('button', { name: 'Close details' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(details(page).getByRole('tab', { name: 'Description' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(details(page).getByRole('button', { name: 'Make draft' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(details(page).getByRole('button', { name: 'Archive card' })).toBeFocused();

  // Interactive controls can be focused, while icon grips are never independent tab stops.
  const focusable = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')]
      .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled'))
      .map((element) => (element.textContent ?? '').trim().slice(0, 3) || element.getAttribute('aria-label')),
  );
  // Header actions, eight cards, the Pending form, then four detail controls.
  expect(focusable).toHaveLength(1 + 1 + 1 + 1 + 1 + 8 + 2 + 4);
  expect(await page.locator('.grip').evaluateAll((elements) => elements.every((element) => (element as HTMLElement).tabIndex < 0))).toBe(true);
});
