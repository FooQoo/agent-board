import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '../helpers/fixtures';
import { agboard, agboardCatalogOk, projectId, skipGuide, taskBody } from '../helpers/agboard';
import { stubArchivePages } from '../helpers/archive-pages';
import { startPhoneEntrance, type PhoneEntrance } from '../helpers/monitor';

// #664: the phone's archive sheet reads 50 tasks at a time and reads the next page as the list scrolls.
test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, locale: 'en-US', timezoneId: 'UTC' });

const TOTAL = 130;
let home: string;
let entrance: PhoneEntrance;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  home = mkdtempSync(path.join(os.tmpdir(), 'agent-board-archive-pages-'));
  skipGuide(home);
  agboardCatalogOk(['project', 'create', 'Pages'], home);
  const added = agboard('Pages', ['add', 'Template task', `--desc=${taskBody('Template.')}`, '--assignee', 'ai', '--actor', 'human'], home);
  if (added.code !== 0) throw new Error(added.stderr);
  entrance = await startPhoneEntrance(home);
});

test.afterAll(async () => {
  await entrance?.stop();
  if (home) rmSync(home, { recursive: true, force: true });
});

async function openSheet(page: Page) {
  await entrance.open(page, `${entrance.phoneOrigin}/?project=${projectId('Pages', home)}`);
  await expect(page.getByRole('tablist', { name: 'Lanes' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Archived tasks' }).tap();
  return page.getByRole('dialog', { name: 'Archived tasks' });
}

/** Scrolls the sheet's body (the scrolling ancestor of the list) to its bottom. */
const scrollToBottom = (page: Page) =>
  page.locator('.archive-sheet__list').evaluate((list) => {
    for (let node = list.parentElement; node; node = node.parentElement) {
      const overflow = getComputedStyle(node).overflowY;
      if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) {
        node.scrollTo(0, node.scrollHeight);
        return;
      }
    }
  });

test('the phone archive sheet loads the next page as the list scrolls and ends after the last', async ({ page }) => {
  const reads = await stubArchivePages(page, { total: TOTAL });
  const sheet = await openSheet(page);
  await expect(sheet.locator('[data-archive-row]').first()).toHaveAttribute('data-archive-row', String(TOTAL));
  expect(await sheet.locator('[data-archive-row]').count()).toBeLessThan(50);
  expect(reads.map((read) => read.cursor)).toEqual([null]);

  await expect
    .poll(async () => {
      await scrollToBottom(page);
      return sheet.getByTestId('archive-end').isVisible();
    })
    .toBe(true);
  expect(reads.map((read) => read.cursor)).toEqual([null, '50', '100']);
  await expect(sheet.locator('[data-archive-row]').last()).toHaveAttribute('data-archive-row', '1');
  await page.screenshot({ path: test.info().outputPath('archive-paging-phone-end.png') });
});

test('a failed page shows a retry in the sheet and reads again only when it is pressed', async ({ page }) => {
  const reads = await stubArchivePages(page, { total: TOTAL, failAt: 50 });
  const sheet = await openSheet(page);
  await expect(sheet.locator('[data-archive-row]').first()).toBeVisible();

  await expect
    .poll(async () => {
      await scrollToBottom(page);
      return sheet.getByText('Could not load more archived tasks.').isVisible();
    })
    .toBe(true);
  const failedReads = reads.length;
  await page.waitForTimeout(500);
  expect(reads.length).toBe(failedReads);

  await sheet.getByRole('button', { name: 'Retry' }).tap();
  await expect
    .poll(async () => {
      await scrollToBottom(page);
      return sheet.getByTestId('archive-end').isVisible();
    })
    .toBe(true);
  await expect(sheet.getByText('Could not load more archived tasks.')).toHaveCount(0);
});
