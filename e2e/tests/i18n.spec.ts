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

  await page.getByRole('button', { name: 'Language' }).click();
  const englishOption = page.getByRole('button', { name: 'English' });
  const japaneseOption = page.getByRole('button', { name: '日本語' });
  await expect(englishOption).toHaveAttribute('aria-pressed', 'true');
  await expect(japaneseOption).toHaveAttribute('aria-pressed', 'false');
  await page.screenshot({ path: testInfo.outputPath('01-english-language-menu.png') });
  await japaneseOption.click();

  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
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

  await page.getByRole('button', { name: '表示言語' }).click();
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(lane(page, 'Todo')).toBeVisible();
  await expect(card(page, 12)).toContainText('Pending');
  expect(listCards().find(({ id }) => id === 12)).toMatchObject({ cardStatus: 'doing', agentStatus: 'pending' });
});

test('keyboard selection keeps an open delete confirmation and the selected card', async ({ page }, testInfo) => {
  await card(page, 12).click();
  const panel = page.getByRole('complementary', { name: 'Card details' });
  await panel.getByRole('button', { name: 'Delete card' }).click();
  await expect(panel.getByText('Delete #12 "Restore a board from JSON"? This cannot be undone.')).toBeVisible();

  const trigger = page.getByRole('button', { name: 'Language' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('group', { name: 'Language' });
  await expect(page.getByRole('button', { name: 'English' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '日本語' })).toBeFocused();
  await page.keyboard.press('Space');

  const japaneseTrigger = page.getByRole('button', { name: '表示言語' });
  await expect(japaneseTrigger).toBeFocused();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(menu).toHaveCount(0);
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

test('the language menu stays within desktop, tablet, and mobile viewports', async ({ page }, testInfo) => {
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 800, height: 900 },
    { width: 480, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    const board = page.getByRole('main');
    const before = await board.boundingBox();
    await page.getByRole('button', { name: 'Language' }).click();

    const menu = page.getByRole('group', { name: 'Language' });
    const bounds = await menu.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    expect((await board.boundingBox())!.width).toBe(before!.width);
    if (viewport.width === 480) {
      await page.screenshot({ path: testInfo.outputPath('04-mobile-language-menu.png') });
    }

    await page.getByRole('button', { name: 'Language' }).click();
  }
});
