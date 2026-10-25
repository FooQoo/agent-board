import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { listTasks, mainHome, resetBoard, mainProject } from '../helpers/agboard';
import { getPreferences, resetPreferences } from '../helpers/preferences';
import { openManualCreateDialog, readBoardAfterReset } from '../helpers/ui';

test.use({ locale: 'ja-JP' });

test.afterEach(() => resetPreferences());

test.beforeEach(async ({ page }) => {
  resetBoard(mainProject);
  await resetPreferences();
  await page.goto('/');
  await expect(page.getByRole('contentinfo').getByRole('status')).toHaveText(/^Synced/);
  // The server notices the reset 200 ms later; read the board again, not the one from before it.
  await readBoardAfterReset(page);
});

const lane = (page: Page, name: string) => page.getByRole('region', { name });
const task = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });

test('starts in English in a Japanese browser, switches and persists without translating board data', async ({
  page,
}, testInfo) => {
  const home = mainHome();
  expect(path.isAbsolute(home)).toBe(true);
  expect(path.dirname(home)).toBe(os.tmpdir());
  expect(home).toContain('agent-board-e2e-main-');
  expect(home).not.toMatch(/Library\/Application Support\/agboard$/);
  expect(await page.evaluate(() => navigator.language)).toBe('ja-JP');
  // Nothing was saved, so the page is English whatever the browser's language is.
  expect((await getPreferences()).locale).toBe('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('banner')).toContainText('Agent Board');
  await expect(lane(page, 'Todo')).toBeVisible();
  await expect(lane(page, 'Doing')).toBeVisible();

  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  const englishOption = settings.getByRole('radio', { name: 'English' });
  const japaneseOption = settings.getByRole('radio', { name: '日本語' });
  await expect(englishOption).toHaveAttribute('aria-checked', 'true');
  await expect(japaneseOption).toHaveAttribute('aria-checked', 'false');
  await page.screenshot({ path: testInfo.outputPath('01-english-settings.png') });
  await japaneseOption.click();

  // The choice applies at once and the dialog stays open; the board behind it is inert until it closes.
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(page.getByRole('dialog', { name: '設定' })).toBeVisible();
  await expect(page.getByRole('radio', { name: '日本語' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(lane(page, '未着手').getByRole('heading', { level: 2 })).toHaveText('未着手');
  await expect(lane(page, '進行中').getByRole('heading', { level: 2 })).toHaveText('進行中');
  await expect(lane(page, '完了').getByRole('heading', { level: 2 })).toHaveText('完了');
  await expect(task(page, 11)).toContainText('稼働中');
  await expect(task(page, 12)).toContainText('待機中');
  await expect(task(page, 13)).toContainText('未稼働');
  await expect(task(page, 12).locator('..')).toContainText('Waiting for confirmation on how to replace a board.');
  await expect(task(page, 12)).toContainText('更新 10/02 10:36');
  await expect(page.getByRole('contentinfo')).toContainText('8件');
  await expect(page.getByRole('contentinfo').getByRole('status')).toHaveText(/^同期済み \d{2}:\d{2}$/);

  await task(page, 12).click();
  const panel = page.getByRole('complementary', { name: 'タスクの詳細' });
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Restore a board from JSON');
  await expect(panel).toContainText('進行中');
  await expect(panel).toContainText('待機中');
  // The question sits on the card (checked above) and in the history, which is read when its tab opens: only the
  // open tab is drawn, so the panel does not hold the history text before then.
  await expect(panel.getByRole('tab', { name: '本文' })).toHaveAttribute('aria-selected', 'true');
  // The count is known once the log is read, so the tab is pressed by its plain name first.
  await panel.getByRole('tab', { name: /^履歴/ }).click();
  await expect(panel.getByRole('tab', { name: '履歴 3' })).toBeVisible();
  await expect(panel.getByRole('tabpanel').getByRole('listitem')).toHaveText([
    '10/02 10:36Waiting for confirmation on how to replace a board.',
    '10/02 01:10Moved task from Todo to Doing.',
    '10/02 00:20Created task in Todo.',
  ]);
  await expect(panel.getByRole('tabpanel').getByRole('img')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('02-japanese-board-detail.png') });
  // The conditions are called 受入条件 on every screen, in the details and in the add dialog.
  await panel.getByRole('tab', { name: /^受入条件/ }).click();
  await expect(panel.getByRole('tabpanel')).toContainText('受入条件');
  await expect(panel).not.toContainText('受け入れ');
  const createDialog = await openManualCreateDialog(page);
  await expect(createDialog.getByRole('button', { name: /^受入条件/ })).toBeVisible();
  await expect(createDialog).not.toContainText('受け入れ');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const storedTask = listTasks(mainProject).find(({ id }) => id === 12);
  expect(storedTask).toMatchObject({
    title: 'Restore a board from JSON',
    taskStatus: 'doing',
    agentStatus: 'pending',
    pendingReason: 'Waiting for confirmation on how to replace a board.',
  });

  expect((await getPreferences()).locale).toBe('ja');
  await expect(page.evaluate(() => localStorage.getItem('agboard.locale'))).resolves.toBe('ja');
  await page.reload();
  await expect(page.getByRole('contentinfo').getByRole('status')).toHaveText(/^同期済み/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(lane(page, '未着手')).toBeVisible();
  await expect(task(page, 12)).toContainText('待機中');

  await page.getByRole('button', { name: '設定' }).click();
  await page.getByRole('radio', { name: 'English' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(lane(page, 'Todo')).toBeVisible();
  await expect(task(page, 12)).toContainText('Pending');
  expect(listTasks(mainProject).find(({ id }) => id === 12)).toMatchObject({ taskStatus: 'doing', agentStatus: 'pending' });
});

test('keyboard selection keeps an open archive confirmation and the selected task', async ({ page }, testInfo) => {
  await task(page, 12).click();
  const panel = page.getByRole('complementary', { name: 'Task details' });
  await panel.getByRole('button', { name: 'Archive task' }).click();
  await expect(panel.getByText('Archive #12 "Restore a board from JSON"? You can restore it from the archive.')).toBeVisible();

  const trigger = page.getByRole('button', { name: 'Settings' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('radio', { name: 'English' })).toBeFocused();
  // The language options are one radio group: the arrow keys move between them and select.
  // Radix selects on arrow keys only while the key is held, so hold it briefly like a person does.
  await page.keyboard.press('ArrowLeft', { delay: 60 });
  await expect(page.getByRole('radio', { name: '日本語' })).toBeFocused();
  await expect(page.getByRole('radio', { name: '日本語' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(page.getByRole('dialog', { name: '設定' })).toBeVisible();
  await page.keyboard.press('Escape');

  const japaneseTrigger = page.getByRole('button', { name: '設定' });
  await expect(japaneseTrigger).toBeFocused();
  await expect(dialog).toHaveCount(0);
  await expect(task(page, 12)).toHaveAttribute('aria-current', 'true');
  const japanesePanel = page.getByRole('complementary', { name: 'タスクの詳細' });
  await expect(
    japanesePanel.getByText('#12「Restore a board from JSON」をアーカイブしますか？ アーカイブ一覧から復元できます。'),
  ).toBeVisible();
  await expect(japanesePanel.getByRole('button', { name: 'アーカイブ', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('03-japanese-archive-confirmation.png') });
  await japanesePanel
    .getByRole('group', { name: /をアーカイブしますか/ })
    .getByRole('button', { name: 'キャンセル', exact: true })
    .click();
  expect(listTasks(mainProject).map(({ id }) => id)).toContain(12);
});

test('the settings dialog stays within the desktop viewports', async ({ page }, testInfo) => {
  for (const viewport of [
    { width: 1024, height: 900 },
    { width: 1280, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    // The open dialog makes the board inert, so it is located by CSS rather than by role.
    const board = page.locator('main.board');
    // The detail width follows the new viewport asynchronously; wait until the board width is stable.
    let previous = -1;
    await expect
      .poll(async () => {
        const width = (await board.boundingBox())!.width;
        const stable = width === previous;
        previous = width;
        return stable;
      })
      .toBe(true);
    const before = await board.boundingBox();
    await page.getByRole('button', { name: 'Settings' }).click();

    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    expect((await board.boundingBox())!.width).toBe(before!.width);
    if (viewport.width === 1024) {
      await page.screenshot({ path: testInfo.outputPath('04-narrow-desktop-settings.png') });
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  }
});
