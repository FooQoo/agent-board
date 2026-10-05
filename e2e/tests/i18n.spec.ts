import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { listCards, mainHome, resetBoard } from '../helpers/agboard';

test.use({ locale: 'ja-JP' });

test.beforeEach(async ({ page }) => {
  resetBoard();
  await page.goto('/');
  await expect(page.getByRole('contentinfo').getByRole('status')).toHaveText(/^Synced/);
});

const lane = (page: Page, name: string) => page.getByRole('region', { name });
const card = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });

test('starts in English in a Japanese browser, switches and persists without translating board data', async ({
  page,
}, testInfo) => {
  const home = mainHome();
  expect(path.isAbsolute(home)).toBe(true);
  expect(path.dirname(home)).toBe(os.tmpdir());
  expect(home).toContain('agent-board-e2e-main-');
  expect(home).not.toMatch(/Library\/Application Support\/skan$/);
  expect(await page.evaluate(() => navigator.language)).toBe('ja-JP');
  expect(await page.evaluate(() => localStorage.getItem('skan.locale'))).toBeNull();
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
  await expect(card(page, 11)).toContainText('稼働中');
  await expect(card(page, 12)).toContainText('待機中');
  await expect(card(page, 13)).toContainText('未稼働');
  await expect(card(page, 12)).toContainText('Waiting for confirmation on how to replace a board.');
  await expect(card(page, 12)).toContainText('更新 10/02 10:36');
  await expect(page.getByRole('contentinfo')).toContainText('8件');
  await expect(page.getByRole('contentinfo').getByRole('status')).toHaveText(/^同期済み \d{2}:\d{2}$/);

  await card(page, 12).click();
  const panel = page.getByRole('complementary', { name: 'カードの詳細' });
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Restore a board from JSON');
  await expect(panel).toContainText('進行中');
  await expect(panel).toContainText('待機中');
  await expect(panel).toContainText('Waiting for confirmation on how to replace a board.');
  await expect(panel.getByRole('heading', { name: '説明' })).toBeVisible();
  await expect(panel.getByText('説明はありません。')).toBeVisible();
  await expect(panel.getByRole('heading', { name: '履歴' })).toBeVisible();
  await expect(panel.getByRole('list')).toContainText('作成');
  await page.screenshot({ path: testInfo.outputPath('02-japanese-board-detail.png') });

  const storedCard = listCards().find(({ id }) => id === 12);
  expect(storedCard).toMatchObject({
    title: 'Restore a board from JSON',
    cardStatus: 'doing',
    agentStatus: 'pending',
    pendingReason: 'Waiting for confirmation on how to replace a board.',
  });

  await expect(page.evaluate(() => localStorage.getItem('skan.locale'))).resolves.toBe('ja');
  await page.reload();
  await expect(page.getByRole('contentinfo').getByRole('status')).toHaveText(/^同期済み/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(lane(page, '未着手')).toBeVisible();
  await expect(card(page, 12)).toContainText('待機中');

  await page.getByRole('button', { name: '設定' }).click();
  await page.getByRole('radio', { name: 'English' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(lane(page, 'Todo')).toBeVisible();
  await expect(card(page, 12)).toContainText('Pending');
  expect(listCards().find(({ id }) => id === 12)).toMatchObject({ cardStatus: 'doing', agentStatus: 'pending' });
});

test('keyboard selection keeps an open delete confirmation and the selected card', async ({ page }, testInfo) => {
  await card(page, 12).click();
  const panel = page.getByRole('complementary', { name: 'Card details' });
  await panel.getByRole('button', { name: 'Delete card' }).click();
  await expect(panel.getByText('Delete #12 "Restore a board from JSON"? This cannot be undone.')).toBeVisible();

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
  await expect(card(page, 12)).toHaveAttribute('aria-current', 'true');
  const japanesePanel = page.getByRole('complementary', { name: 'カードの詳細' });
  await expect(
    japanesePanel.getByText('#12「Restore a board from JSON」を削除しますか？ この操作は元に戻せません。'),
  ).toBeVisible();
  await expect(japanesePanel.getByRole('button', { name: '削除' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('03-japanese-delete-confirmation.png') });
  await japanesePanel.getByRole('button', { name: 'キャンセル' }).click();
  expect(listCards().map(({ id }) => id)).toContain(12);
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
