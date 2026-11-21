import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mainHome, mainProject, projectId, resetBoard } from '../helpers/agboard';
import { messageList, openMessageList } from '../helpers/answer';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../helpers/fixtures';
import { readBoardAfterReset, waitForSync } from '../helpers/ui';

// The Summary tab of the messages: it lists the periodic summaries found in the project's notify
// folder, and the trash sets one aside without removing its line.

const line = (id: string, end: string, taskId: number, title: string, version?: number) =>
  JSON.stringify({
    id,
    dismissed: false,
    from: '2026-11-20T09:00:00Z',
    to: end,
    results: [{ taskId, ...(version === undefined ? {} : { version }), title, at: '2026-11-20T09:30:00Z' }],
  });

function notifyFile(): string {
  return path.join(mainHome(), 'shared', 'projects', projectId(mainProject), 'notify', '2026-11-20.ldjson');
}

function writeSummaries(): void {
  const file = notifyFile();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    `${line('s-20261120T100000Z', '2026-11-20T10:00:00Z', 552, 'Pull to refresh on the phone board', 2)}\n${line('s-20261120T110000Z', '2026-11-20T11:00:00Z', 553, 'Bottom navigation bar')}\n`,
  );
}

const records = () =>
  readFileSync(notifyFile(), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { id: string; dismissed: boolean });

test.beforeEach(() => {
  resetBoard(mainProject);
  writeSummaries();
});

test.afterEach(() => {
  rmSync(path.dirname(notifyFile()), { recursive: true, force: true });
});

test('the Summary tab lists the summaries and the trash dismisses one', async ({ page }) => {
  await page.goto('/');
  await waitForSync(page);
  await readBoardAfterReset(page);
  const list = await openMessageList(page);
  const tab = list.getByRole('tab', { name: /^Summary/ });
  await expect(tab).toContainText('2');
  await tab.click();

  await expect(list.getByText('#552')).toBeVisible();
  await expect(list.getByText('Pull to refresh on the phone board')).toBeVisible();
  await expect(list.getByText('#553')).toBeVisible();

  // The newest window is first; its trash button is on the left of the item.
  const trash = list.getByRole('button', { name: 'Delete this summary' });
  await expect(trash).toHaveCount(2);
  await trash.first().click();

  await expect(list.getByText('#553')).toHaveCount(0);
  await expect(list.getByText('#552')).toBeVisible();
  await expect(tab).toContainText('1');
  // The record stays on disk with `dismissed` set.
  await expect.poll(() => records().find((r) => r.id === 's-20261120T110000Z')?.dismissed).toBe(true);
  expect(records()).toHaveLength(2);

  // A reload still hides it.
  await page.reload();
  const again = await openMessageList(page);
  await again.getByRole('tab', { name: /^Summary/ }).click();
  await expect(again.getByText('#553')).toHaveCount(0);
  await expect(again.getByText('#552')).toBeVisible();
});

test('a result row links to that version of the task results; a line without a version links to the tab', async ({ page }) => {
  await page.goto('/');
  await waitForSync(page);
  await readBoardAfterReset(page);
  const list = await openMessageList(page);
  await list.getByRole('tab', { name: /^Summary/ }).click();

  const id = projectId(mainProject);
  const linked = list.getByRole('link', { name: 'Open result v2 of task #552: Pull to refresh on the phone board' });
  await expect(linked).toContainText('Result v2');
  await expect(linked).toHaveAttribute('href', `?project=${id}&task=552&result=2`);
  // A line written before versions were recorded still links, with no version shown.
  const old = list.getByRole('link', { name: 'Open the results of task #553: Bottom navigation bar' });
  await expect(old).toHaveAttribute('href', `?project=${id}&task=553&tab=results`);

  // The row is reached with the keyboard and opened with Enter, without loading the page again.
  await page.evaluate(() => {
    (window as unknown as { __noReload: boolean }).__noReload = true;
  });
  await linked.focus();
  await expect(linked).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => new URL(page.url()).searchParams.get('result')).toBe('2');
  expect(new URL(page.url()).searchParams.get('task')).toBe('552');
  expect(new URL(page.url()).searchParams.get('messages')).toBeNull();
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
  // The message list gave way to the task.
  await expect(messageList(page)).toHaveCount(0);
});

test('a plain click on a result opens it in the page, and a modified click is left to the browser', async ({ page }) => {
  await page.goto('/');
  await waitForSync(page);
  await readBoardAfterReset(page);
  const list = await openMessageList(page);
  await list.getByRole('tab', { name: /^Summary/ }).click();
  const linked = list.getByRole('link', { name: 'Open result v2 of task #552: Pull to refresh on the phone board' });
  await page.evaluate(() => {
    (window as unknown as { __noReload: boolean }).__noReload = true;
  });
  const navigations: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url());
  });

  // Control-click is not taken over: the page does not change, and the browser opens the link itself.
  const popup = page.context().waitForEvent('page');
  await linked.click({ modifiers: ['ControlOrMeta'] });
  const opened = await popup;
  expect(new URL(opened.url()).searchParams.get('task') ?? new URL(opened.url(), page.url()).searchParams.get('task')).toBe('552');
  await opened.close();
  await expect(list).toBeVisible();

  await linked.click();
  await expect.poll(() => new URL(page.url()).searchParams.get('result')).toBe('2');
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
  await expect(messageList(page)).toHaveCount(0);
  // The history moved by one entry in the same document: no load happened.
  expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(1);
  expect(navigations.every((url) => url.includes('result=2'))).toBe(true);
});

// Enough summaries that the list scrolls; each links to the real task 11 of the fixture.
function writeManySummaries(): void {
  const file = notifyFile();
  mkdirSync(path.dirname(file), { recursive: true });
  const rows = Array.from({ length: 40 }, (_, i) => {
    const hour = String((i % 23) + 1).padStart(2, '0');
    const day = i < 23 ? '20' : '19';
    return line(`s-202611${day}T${hour}0000Z`, `2026-11-${day}T${hour}:00:00Z`, 11, `Scrolled result ${i + 1}`, 1);
  });
  writeFileSync(file, `${rows.join('\n')}\n`);
}

/** How far the list is scrolled: the PC modal scrolls in the swipe viewport, a phone sheet in its body. */
const scrolledTop = (list: Locator) =>
  list.locator('.surface__body, .message-list__viewport').evaluateAll((els) => Math.max(...els.map((el) => el.scrollTop)));

/** Opens the Summary list, scrolls it down, follows a result near the bottom, and gives back where the list was. */
async function openResultFromScrolledList(page: Page) {
  await page.goto(`/?project=${projectId(mainProject)}&messages=summary`);
  const list = messageList(page);
  await expect(list.getByRole('tab', { name: /^Summary/ })).toHaveAttribute('aria-selected', 'true');
  const link = list.getByRole('link', { name: /^Open result v1 of task #11: Scrolled result 3$/ });
  await link.scrollIntoViewIfNeeded();
  const before = await scrolledTop(list);
  expect(before).toBeGreaterThan(0);
  await page.evaluate(() => {
    (window as unknown as { __noReload: boolean }).__noReload = true;
  });
  await link.click();
  await expect.poll(() => new URL(page.url()).searchParams.get('task')).toBe('11');
  await expect(messageList(page)).toHaveCount(0);
  return { before };
}

async function expectBackOnSummary(page: Page, before: number) {
  const list = messageList(page);
  await expect(list).toBeVisible();
  await expect(list.getByRole('tab', { name: /^Summary/ })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => scrolledTop(list)).toBeGreaterThan(before - 4);
  expect(await scrolledTop(list)).toBeLessThan(before + 4);
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
}

test('closing the task opened from a summary result gives the Summary list back where it was', async ({ page }) => {
  writeManySummaries();
  const { before } = await openResultFromScrolledList(page);
  const details = page.getByRole('complementary', { name: 'Task details' });
  await expect(details).toBeVisible();
  await details.getByRole('button', { name: 'Close details' }).click();
  await expectBackOnSummary(page, before);
});

test('a summary link opens the messages on the Summary tab', async ({ page }) => {
  await page.goto(`/?project=${projectId(mainProject)}&messages=summary`);
  const list = messageList(page);
  await expect(list).toBeVisible();
  await expect(list.getByRole('tab', { name: /^Summary/ })).toHaveAttribute('aria-selected', 'true');
  await expect(list.getByText('#552')).toBeVisible();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('closing the task opened from a summary result gives the Summary list back where it was', async ({ page }) => {
    writeManySummaries();
    const { before } = await openResultFromScrolledList(page);
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await page.keyboard.press('Escape');
    await expectBackOnSummary(page, before);
  });

  test('a tap shows the trash tile and tapping it dismisses the summary', async ({ page }) => {
    await page.goto(`/?project=${projectId(mainProject)}&messages=summary`);
    const sheet = messageList(page);
    await expect(sheet.getByRole('tab', { name: /^Summary/ })).toHaveAttribute('aria-selected', 'true');
    await expect(sheet.getByText('#553')).toBeVisible();

    await sheet.getByText(/^11\/20 /).first().tap();
    const tile = sheet.getByRole('button', { name: 'Delete this summary' }).first();
    await expect(tile).toBeVisible();
    await tile.tap();

    await expect(sheet.getByText('#553')).toHaveCount(0);
    await expect.poll(() => records().filter((r) => r.dismissed).length).toBe(1);
  });
});
