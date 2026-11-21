import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '../helpers/fixtures';
import { agboard, agboardCatalogOk, projectId, skipGuide, taskBody } from '../helpers/agboard';
import { startPhoneEntrance, type PhoneEntrance } from '../helpers/monitor';

// The phone monitor's lane view through the phone entrance, driven with a finger: one lane on screen,
// lane tabs, a horizontal swipe between lanes, a card chosen by a long press and slid open for its
// action buttons, and the done lane's bulk archive. Each test reads its own project, and every result
// is also read back from the shared files through the CLI, not only from the screen.
test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, locale: 'en-US', timezoneId: 'UTC' });

type Lane = 'todo' | 'doing' | 'done';
interface Seed {
  title: string;
  lane: Lane;
}

let home: string;
let entrance: PhoneEntrance;
const ids = new Map<string, number>();

function cli(project: string, args: string[]): string {
  const result = agboard(project, args, home);
  if (result.code !== 0) throw new Error(`agboard ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

function seed(project: string, cards: Seed[]): void {
  agboardCatalogOk(['project', 'create', project], home);
  for (const { title, lane } of cards) {
    const added = JSON.parse(
      cli(project, ['add', title, `--desc=${taskBody(`${title} body.`)}`, '--assignee', 'ai', '--actor', 'human', '--json']),
    ) as { task: { id: number } };
    ids.set(`${project}:${title}`, added.task.id);
    if (lane !== 'todo') cli(project, ['mv', String(added.task.id), 'doing', '--actor', 'ai', '--reason', 'Start']);
    if (lane === 'done') cli(project, ['mv', String(added.task.id), 'done', '--actor', 'ai', '--reason', 'Finish']);
  }
}

function show(project: string, title: string): { taskStatus: Lane; archivedAt: string | null } {
  const id = ids.get(`${project}:${title}`);
  return JSON.parse(cli(project, ['show', String(id), '--json'])).task;
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  home = mkdtempSync(path.join(os.tmpdir(), 'agent-board-lanes-'));
  skipGuide(home);
  seed('Switch', [
    { title: 'Switch todo A', lane: 'todo' },
    { title: 'Switch todo B', lane: 'todo' },
    { title: 'Switch doing', lane: 'doing' },
    { title: 'Switch done', lane: 'done' },
  ]);
  seed('Scroll', Array.from({ length: 12 }, (_, i) => ({ title: `Scroll card ${i + 1}`, lane: 'todo' as const })));
  seed('Move', [
    { title: 'Move forward', lane: 'todo' },
    { title: 'Move finish', lane: 'doing' },
    { title: 'Move back', lane: 'doing' },
    { title: 'Move reopen', lane: 'done' },
    { title: 'Move bystander', lane: 'todo' },
  ]);
  seed('Archive', [
    { title: 'Archive target', lane: 'todo' },
    { title: 'Archive kept', lane: 'todo' },
  ]);
  seed('Bulk', [
    { title: 'Bulk todo', lane: 'todo' },
    { title: 'Bulk done one', lane: 'done' },
    { title: 'Bulk done two', lane: 'done' },
    { title: 'Bulk done three', lane: 'done' },
  ]);
  seed('Quiet', [{ title: 'Quiet todo', lane: 'todo' }]);
  entrance = await startPhoneEntrance(home);
});

test.afterAll(async () => {
  await entrance?.stop();
  if (home) rmSync(home, { recursive: true, force: true });
});

async function openPhone(page: Page, project: string): Promise<void> {
  await entrance.open(page, `${entrance.phoneOrigin}/?project=${projectId(project, home)}`);
  await expect(page.getByRole('tablist', { name: 'Lanes' })).toBeVisible();
}

const tab = (page: Page, name: string, selected?: boolean) =>
  page.getByRole('tab', { name, selected });

/** The lane on screen: the other two lanes are inert, so only this panel takes a finger or a screen reader. */
const shown = (page: Page) => page.locator('[role="tabpanel"]:not([inert])');

/** The element a finger lands on for a card: its swipe wrapper (the buttons sit beside the article). */
const swipeCard = (page: Page, title: string) =>
  page.locator('[data-swipe-card]').filter({ has: page.getByRole('article', { name: new RegExp(title) }) });

interface Point {
  x: number;
  y: number;
}

/**
 * One finger: press at `from`, optionally run `afterPress` (a long press waits for the card to be
 * chosen), move to `to` in steps, and lift.
 */
async function finger(page: Page, from: Point, to: Point, afterPress?: () => Promise<void>): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    await afterPress?.();
    const steps = 12;
    for (let i = 1; i <= steps; i += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await cdp.detach();
  }
}

/** Measure an element once the lane slide has stopped moving it. */
async function box(locator: Locator) {
  let last = '';
  await expect
    .poll(async () => {
      const now = JSON.stringify(await locator.boundingBox());
      const still = now === last;
      last = now;
      return still;
    })
    .toBe(true);
  const b = await locator.boundingBox();
  if (!b) throw new Error('Could not measure the element.');
  return b;
}

/** Swipe sideways across a card (`direction` -1 is to the left) without holding it first. */
async function swipeOver(page: Page, card: Locator, direction: -1 | 1): Promise<void> {
  const b = await box(card);
  const y = b.y + b.height / 2;
  await finger(page, { x: b.x + b.width * (direction < 0 ? 0.8 : 0.2), y }, { x: b.x + b.width * (direction < 0 ? 0.2 : 0.8), y });
}

/** Hold a card until it is chosen, then slide it sideways without lifting. */
async function holdAndSwipe(page: Page, card: Locator, direction: -1 | 1): Promise<void> {
  const b = await box(card);
  const y = b.y + b.height / 2;
  await finger(
    page,
    { x: b.x + b.width * (direction < 0 ? 0.8 : 0.2), y },
    { x: b.x + b.width * (direction < 0 ? 0.2 : 0.8), y },
    () => expect(card).toHaveAttribute('data-armed', 'true'),
  );
}

// #447
test('a horizontal swipe, even one that starts on a card, and the tabs switch between the three lanes', async ({ page }) => {
  await openPhone(page, 'Switch');
  await expect(tab(page, 'Todo 2', true)).toBeVisible();
  await expect(tab(page, 'Doing 1')).toBeVisible();
  await expect(tab(page, 'Done 1')).toBeVisible();
  // One lane is on screen, and the other two are inert.
  await expect(shown(page)).toHaveCount(1);
  await expect(shown(page).getByRole('article')).toHaveCount(2);
  await expect(shown(page).getByRole('article', { name: /Switch todo A/ })).toBeVisible();

  // A swipe that starts over a card that was not held moves the lanes, and slides no card.
  const first = swipeCard(page, 'Switch todo A');
  await swipeOver(page, first, -1);
  await expect(tab(page, 'Doing 1', true)).toBeVisible();
  await expect(shown(page).getByRole('article')).toHaveCount(1);
  await expect(shown(page).getByRole('article', { name: /Switch doing/ })).toBeVisible();
  await expect(page.locator('[data-swipe-card][data-revealed]')).toHaveCount(0);

  await swipeOver(page, swipeCard(page, 'Switch doing'), -1);
  await expect(tab(page, 'Done 1', true)).toBeVisible();
  await expect(page.getByRole('article', { name: /Switch done/ })).toBeVisible();

  // The done lane is the last: a swipe further left stays on it and opens the bulk-archive drawer.
  await expect(page.getByRole('heading', { level: 2, name: /^Done/ })).toHaveCount(0);
  await swipeOver(page, swipeCard(page, 'Switch done'), -1);
  const bulk = page.getByRole('dialog', { name: 'Archive completed tasks' });
  await expect(bulk).toBeVisible();
  await bulk.getByRole('button', { name: 'Cancel' }).click();
  await expect(bulk).toHaveCount(0);
  await expect(tab(page, 'Done 1', true)).toBeVisible();
  // The button after the last done card asks for the same drawer.
  await expect(page.getByRole('button', { name: 'Archive all' })).toBeEnabled();

  // Back to the right, across the cards, to the first lane.
  await swipeOver(page, swipeCard(page, 'Switch done'), 1);
  await expect(tab(page, 'Doing 1', true)).toBeVisible();
  await swipeOver(page, swipeCard(page, 'Switch doing'), 1);
  await expect(tab(page, 'Todo 2', true)).toBeVisible();
  await expect(shown(page).getByRole('article', { name: /Switch todo B/ })).toBeVisible();

  // Tapping a tab switches too, in any order.
  await tab(page, 'Done 1').tap();
  await expect(tab(page, 'Done 1', true)).toBeVisible();
  await expect(shown(page).getByRole('article', { name: /Switch done/ })).toBeVisible();
  await tab(page, 'Doing 1').tap();
  await expect(tab(page, 'Doing 1', true)).toBeVisible();
  await tab(page, 'Todo 2').tap();
  await expect(tab(page, 'Todo 2', true)).toBeVisible();
  await expect(shown(page).getByRole('article', { name: /Switch todo A/ })).toBeVisible();
});

// #447, #448: scrolling is not a lane switch
test('a vertical scroll over the cards scrolls the lane and does not switch lanes', async ({ page }) => {
  await openPhone(page, 'Scroll');
  await expect(tab(page, 'Todo 12', true)).toBeVisible();
  const scroller = page.locator('.monitor-lane[data-lane="todo"] .monitor-lane__scroll');
  const lane = await box(scroller);
  const x = lane.x + lane.width / 2;
  const top = lane.y + lane.height - 40;
  const before = await scroller.evaluate((el) => el.scrollTop);
  // Slightly diagonal, as a real thumb is, but clearly more vertical than horizontal.
  await finger(page, { x: x + 10, y: top }, { x: x - 10, y: lane.y + 40 });
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(before);
  await expect(tab(page, 'Todo 12', true)).toBeVisible();
  await expect(tab(page, 'Doing 0', true)).toHaveCount(0);
});

// #448
test('a long-pressed card swipes open and moves forward and back, and the files change', async ({ page }) => {
  await openPhone(page, 'Move');
  await expect(tab(page, 'Todo 2', true)).toBeVisible();

  // An unselected card only switches lanes: nothing opens, and no confirmation appears.
  await swipeOver(page, swipeCard(page, 'Move forward'), -1);
  await expect(tab(page, 'Doing 2', true)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await tab(page, 'Todo 2').tap();
  await expect(tab(page, 'Todo 2', true)).toBeVisible();

  // Todo -> Doing: the long press chooses the card, the left swipe shows the lane to its right and the archive.
  const forward = swipeCard(page, 'Move forward');
  await holdAndSwipe(page, forward, -1);
  await expect(forward).toHaveAttribute('data-revealed', 'right');
  await expect(page.getByRole('button', { name: /^Move #\d+ to Doing$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Archive #\d+$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Move #\d+ to Todo$/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Move #\d+ to Done$/ })).toHaveCount(0);
  // The move is made at once: no dialog asks, and the file changes.
  await page.getByRole('button', { name: /^Move #\d+ to Doing$/ }).tap();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => show('Move', 'Move forward').taskStatus).toBe('doing');
  // The saved move stays on screen: the counts follow it.
  await expect(tab(page, 'Todo 1')).toBeVisible();
  await expect(tab(page, 'Doing 3')).toBeVisible();

  // Doing -> Done by the same left swipe.
  await tab(page, 'Doing 3').tap();
  const finish = swipeCard(page, 'Move finish');
  await holdAndSwipe(page, finish, -1);
  await expect(finish).toHaveAttribute('data-revealed', 'right');
  await page.getByRole('button', { name: /^Move #\d+ to Done$/ }).tap();
  await expect.poll(() => show('Move', 'Move finish').taskStatus).toBe('done');
  await expect(tab(page, 'Doing 2')).toBeVisible();
  await expect(tab(page, 'Done 2')).toBeVisible();

  // The other direction: a right swipe shows only the lane to its left. Doing -> Todo.
  const back = swipeCard(page, 'Move back');
  await holdAndSwipe(page, back, 1);
  await expect(back).toHaveAttribute('data-revealed', 'left');
  await expect(page.getByRole('button', { name: /^Move #\d+ to Todo$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Move #\d+ to Done$/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Archive #\d+$/ })).toHaveCount(0);
  await page.getByRole('button', { name: /^Move #\d+ to Todo$/ }).tap();
  await expect.poll(() => show('Move', 'Move back').taskStatus).toBe('todo');

  // Done -> Doing.
  await tab(page, 'Done 2').tap();
  const reopen = swipeCard(page, 'Move reopen');
  await holdAndSwipe(page, reopen, 1);
  await expect(reopen).toHaveAttribute('data-revealed', 'left');
  await page.getByRole('button', { name: /^Move #\d+ to Doing$/ }).tap();
  await expect.poll(() => show('Move', 'Move reopen').taskStatus).toBe('doing');

  // The card nobody touched is where it was.
  expect(show('Move', 'Move bystander').taskStatus).toBe('todo');
  await expect(tab(page, 'Todo 2')).toBeVisible();
  await expect(tab(page, 'Doing 2')).toBeVisible();
  await expect(tab(page, 'Done 1')).toBeVisible();
});

// #449
test('a chosen card is archived from its left-swipe button after a confirmation', async ({ page }) => {
  await openPhone(page, 'Archive');
  const target = swipeCard(page, 'Archive target');
  await holdAndSwipe(page, target, -1);
  await expect(target).toHaveAttribute('data-revealed', 'right');
  await page.getByRole('button', { name: /^Archive #\d+$/ }).tap();

  const dialog = page.getByRole('dialog', { name: 'Archive task' });
  await expect(dialog).toContainText('Archive target');
  // Cancel: nothing is archived.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect(show('Archive', 'Archive target').archivedAt).toBeNull();

  // The tap on Cancel was outside the card, which let it go; hold it and slide it open again.
  await holdAndSwipe(page, target, -1);
  await expect(target).toHaveAttribute('data-revealed', 'right');
  await page.getByRole('button', { name: /^Archive #\d+$/ }).tap();
  await dialog.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => show('Archive', 'Archive target').archivedAt).not.toBeNull();
  await expect(shown(page).getByRole('article', { name: /Archive target/ })).toHaveCount(0);
  await expect(tab(page, 'Todo 1')).toBeVisible();
  expect(show('Archive', 'Archive kept').archivedAt).toBeNull();
});

// #449
test('swiping a chosen card back, or tapping outside it, closes its buttons without a change', async ({ page }) => {
  await openPhone(page, 'Switch');
  const card = swipeCard(page, 'Switch todo A');

  // Swipe back.
  await holdAndSwipe(page, card, -1);
  await expect(card).toHaveAttribute('data-revealed', 'right');
  const b = await box(card);
  const y = b.y + b.height / 2;
  await finger(page, { x: b.x + b.width * 0.3, y }, { x: b.x + b.width * 0.9, y });
  await expect(card).not.toHaveAttribute('data-revealed', /.*/);
  await expect(page.getByRole('button', { name: /^Archive #\d+$/ })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // The card is still chosen, so it can open again; a tap outside lets it go and closes it.
  await swipeOver(page, card, -1);
  await expect(card).toHaveAttribute('data-revealed', 'right');
  const other = await box(swipeCard(page, 'Switch todo B'));
  await page.touchscreen.tap(other.x + other.width / 2, other.y + other.height + 30);
  await expect(card).not.toHaveAttribute('data-revealed', /.*/);
  await expect(card).not.toHaveAttribute('data-armed', /.*/);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  expect(show('Switch', 'Switch todo A')).toMatchObject({ taskStatus: 'todo', archivedAt: null });
  await expect(tab(page, 'Todo 2', true)).toBeVisible();
});

// #450
test('the done lane archives all its cards at once, and the button is gone when the lane is empty', async ({ page }) => {
  await openPhone(page, 'Bulk');
  await tab(page, 'Done 3').tap();
  const bulk = page.getByRole('button', { name: 'Archive all' });
  await expect(bulk).toBeEnabled();
  // The button ends the list, so the cards keep their place whether or not it shows.
  const lastCard = await box(swipeCard(page, 'Bulk done one'));
  const bulkBox = await box(bulk);
  expect(bulkBox.y).toBeGreaterThanOrEqual(lastCard.y + lastCard.height);
  await bulk.tap();

  const dialog = page.getByRole('dialog', { name: 'Archive completed tasks' });
  await expect(dialog).toContainText('Archive 3 completed tasks');
  // Cancel first: nothing is archived.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  for (const title of ['Bulk done one', 'Bulk done two', 'Bulk done three']) expect(show('Bulk', title).archivedAt).toBeNull();

  await bulk.tap();
  await dialog.getByRole('button', { name: 'Archive 3 tasks' }).click();
  await expect(dialog).toHaveCount(0);
  for (const title of ['Bulk done one', 'Bulk done two', 'Bulk done three'])
    await expect.poll(() => show('Bulk', title).archivedAt).not.toBeNull();
  // Only the done cards went; the saved result stays on screen and the lane is empty.
  expect(show('Bulk', 'Bulk todo')).toMatchObject({ taskStatus: 'todo', archivedAt: null });
  await expect(tab(page, 'Done 0', true)).toBeVisible();
  await expect(tab(page, 'Todo 1')).toBeVisible();
  await expect(shown(page).getByRole('article')).toHaveCount(0);
  await expect(bulk).toHaveCount(0);
});

// #450
test('the bulk archive button is not offered while the done lane is empty', async ({ page }) => {
  await openPhone(page, 'Quiet');
  await tab(page, 'Done 0').tap();
  await expect(tab(page, 'Done 0', true)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Archive all' })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('pulling a lane down from its top refreshes the board, a short pull does not, and no refresh button is left', async ({ page }) => {
  await openPhone(page, 'Quiet');
  await expect(page.getByRole('button', { name: 'Refresh' })).toHaveCount(0);
  const summaries: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/projects\/[^/]+\/summary/.test(request.url())) summaries.push(request.url());
  });
  const card = swipeCard(page, 'Quiet todo');
  const b = await box(card);
  const from = { x: b.x + b.width / 2, y: b.y + b.height / 2 };

  // A short pull shows the hint at most and refreshes nothing.
  await finger(page, from, { x: from.x, y: from.y + 40 });
  await page.waitForTimeout(500);
  expect(summaries).toHaveLength(0);

  // A long pull releases into a refresh: the board asks for its Summary again.
  await finger(page, from, { x: from.x, y: from.y + 140 });
  await expect.poll(() => summaries.length).toBeGreaterThan(0);
  await expect(page.locator('.monitor-pull')).toHaveCount(0);
  await expect(tab(page, 'Todo 1', true)).toBeVisible();
});

const bottomBar = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' });

test('the bottom bar has Board, Messages, Ask, Archive and Settings, with Ask in the middle, and clears the home indicator', async ({ page }) => {
  await openPhone(page, 'Switch');
  const bar = bottomBar(page);
  await expect(bar).toBeVisible();
  const items = bar.getByRole('button');
  expect(await items.evaluateAll((all) => all.map((item) => item.textContent?.replace(/^\d+/, '')))).toEqual([
    'Board',
    'Messages',
    'Ask',
    'Archive',
    'Settings',
  ]);
  // The entry points the bar took over are gone from the strip and the header; no message waits, so no number shows.
  await expect(page.getByRole('region', { name: 'Messages' })).toHaveCount(0);
  await expect(page.locator('.header__settings')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Refresh' })).toHaveCount(0);
  await expect(bar.locator('.phone-nav__badge')).toHaveCount(0);
  const ask = await items.nth(2).boundingBox();
  const barBox = await bar.boundingBox();
  if (!ask || !barBox) throw new Error('the bar has no box');
  expect(Math.abs(ask.x + ask.width / 2 - (barBox.x + barBox.width / 2))).toBeLessThanOrEqual(2);

  // On an iPhone with a home indicator the dock floats above it: its bottom margin is at least the inset.
  await page.evaluate(() => document.documentElement.style.setProperty('--safe-bottom', '34px'));
  const margin = await bar.evaluate((element) => parseFloat(getComputedStyle(element).marginBottom));
  expect(margin).toBeGreaterThanOrEqual(34);
  const after = await bar.boundingBox();
  const viewport = page.viewportSize();
  if (!after || !viewport) throw new Error('the bar has no box');
  expect(after.y + after.height).toBeLessThanOrEqual(viewport.height - 34 + 1);
});

test('Messages opens the messages drawer without an Ask entry, and Ask opens the request form directly', async ({ page }) => {
  await openPhone(page, 'Switch');
  await bottomBar(page).getByRole('button', { name: 'Messages' }).tap();
  const list = page.getByRole('dialog', { name: 'Messages' });
  await expect(list).toBeVisible();
  await expect(list.getByRole('tab')).toHaveCount(3);
  await expect(list.getByRole('button', { name: /Ask/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();

  await bottomBar(page).getByRole('button', { name: 'Ask AI' }).tap();
  await expect(page.getByRole('dialog', { name: 'Ask AI' })).toBeVisible();
});

test('the bottom bar stays in front of an open sheet, the sheet runs behind it and its content ends above it, and its items switch sheets', async ({ page }) => {
  await openPhone(page, 'Switch');
  // The dialog marks the page behind it aria-hidden, so the bar is found by its class while a sheet is open.
  const bar = page.locator('.phone-nav');
  const item = (name: string) => bar.locator('button', { hasText: name });
  await bottomBar(page).getByRole('button', { name: 'Messages' }).tap();
  const messages = page.getByRole('dialog', { name: 'Messages' });
  await expect(messages).toBeVisible();
  await page.waitForTimeout(500);

  const sheetBox = await messages.boundingBox();
  const barBox = await bar.boundingBox();
  if (!sheetBox || !barBox) throw new Error('the sheet or the bar has no box');
  // The sheet's surface runs to the bottom of the screen, behind the bar, and its content ends at the bar.
  const viewportHeight = page.viewportSize()?.height ?? 0;
  expect(Math.abs(sheetBox.y + sheetBox.height - viewportHeight)).toBeLessThanOrEqual(1);
  const contentBox = await messages.locator('.mobile-drawer__content').boundingBox();
  if (!contentBox) throw new Error('the sheet has no content box');
  expect(contentBox.y + contentBox.height).toBeLessThanOrEqual(barBox.y + 1);
  expect(contentBox.y + contentBox.height).toBeGreaterThan(barBox.y - 3);
  // What a finger lands on in the middle of the bar is the bar, not the sheet or its backdrop.
  const topmost = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.phone-nav') !== null, [
    barBox.x + barBox.width / 2,
    barBox.y + barBox.height / 2,
  ]);
  expect(topmost).toBe(true);

  // Another item replaces the sheet at once, with one dialog on screen; Board closes it.
  await item('Settings').tap();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await item('Board').tap();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Settings opens as a drawer, Archive lists archived tasks in a drawer, and the bulk archive asks in a drawer that cancels without a change', async ({ page }) => {
  await openPhone(page, 'Switch');
  await bottomBar(page).getByRole('button', { name: 'Settings' }).tap();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings).toBeVisible();
  await expect(settings).toHaveAttribute('data-slot', 'drawer-popup');
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();

  await bottomBar(page).getByRole('button', { name: 'Archived tasks' }).tap();
  const list = page.getByRole('dialog', { name: 'Archived tasks' });
  await expect(list).toBeVisible();
  await expect(list).toHaveAttribute('data-slot', 'drawer-popup');
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();

  await tab(page, 'Done 1').tap();
  await page.getByRole('button', { name: 'Archive all' }).tap();
  const drawer = page.getByRole('dialog', { name: 'Archive completed tasks' });
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute('data-slot', 'drawer-popup');
  await expect(drawer.getByRole('row')).toHaveCount(2);
  await drawer.getByRole('button', { name: 'Cancel' }).tap();
  await expect(drawer).toBeHidden();
  expect(show('Switch', 'Switch done').archivedAt).toBeNull();
});
