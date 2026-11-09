import { expect, test, type Page } from '@playwright/test';

// The top page picks its language in the browser: a Japanese browser opens the Japanese top
// page, a choice made in the nav's language menu wins afterwards, and deep links never move.
const storageKey = 'agent-board-docs-lang';
const enTop = /\/agent-board\/$/;
const jaTop = /\/agent-board\/ja\/$/;

async function savedChoice(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), storageKey);
}

async function pickInDesktopMenu(page: Page, current: string, label: string) {
  const menu = page.locator('.VPNavBarTranslations');
  await menu.getByRole('button', { name: current }).click();
  await menu.getByRole('link', { name: label }).click();
}

test.describe('a Japanese browser', () => {
  test.use({ locale: 'ja-JP' });

  test('opens the Japanese top page from the English top page', async ({ page }) => {
    await page.goto('');
    await expect(page).toHaveURL(jaTop);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
    expect(await savedChoice(page)).toBeNull();
  });

  test('keeps the query and the fragment when it moves', async ({ page }) => {
    await page.goto('?from=readme#install');
    await expect(page).toHaveURL(/\/agent-board\/ja\/\?from=readme#install$/);
  });

  for (const deepLink of ['guide/', 'guide/use/board', 'dev/', 'releases']) {
    test(`stays on the deep link ${deepLink}`, async ({ page }) => {
      await page.goto(deepLink);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      expect(new URL(page.url()).pathname).toBe(`/agent-board/${deepLink}`);
    });
  }

  test('stays on the English top page after English is picked in the language menu', async ({ page }) => {
    await page.goto('');
    await expect(page).toHaveURL(jaTop);
    await pickInDesktopMenu(page, '言語を変更', 'English');
    await expect(page).toHaveURL(enTop);
    expect(await savedChoice(page)).toBe('en');

    // A fresh load of the top page now follows the saved choice, not the browser.
    await page.goto('');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(new URL(page.url()).pathname).toBe('/agent-board/');
  });

  test('remembers a choice made in the phone menu', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('');
    await expect(page).toHaveURL(jaTop);
    await page.locator('.VPNavBarHamburger').click();
    const menu = page.locator('.VPNavScreenTranslations');
    await menu.locator('button.title').click();
    await menu.getByRole('link', { name: 'English' }).click();
    await expect(page).toHaveURL(enTop);
    expect(await savedChoice(page)).toBe('en');

    await page.goto('');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});

test.describe('an English browser', () => {
  test.use({ locale: 'en-US' });

  test('stays on the English top page', async ({ page }) => {
    await page.goto('');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(new URL(page.url()).pathname).toBe('/agent-board/');
  });

  test('opens the Japanese top page after Japanese is picked in the language menu', async ({ page }) => {
    await page.goto('guide/');
    await pickInDesktopMenu(page, 'Change language', '日本語');
    await expect(page).toHaveURL(/\/agent-board\/ja\/guide\/$/);
    expect(await savedChoice(page)).toBe('ja');

    await page.goto('');
    await expect(page).toHaveURL(jaTop);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');

    // The saved choice moves only the top page; a deep link still opens as linked.
    await page.goto('guide/use/board');
    expect(new URL(page.url()).pathname).toBe('/agent-board/guide/use/board');
  });

  test('still opens the top page when storage is blocked', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new Error('blocked');
        },
      });
    });
    await page.goto('guide/');
    await pickInDesktopMenu(page, 'Change language', '日本語');
    await expect(page).toHaveURL(/\/agent-board\/ja\/guide\/$/);
    await page.goto('');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(new URL(page.url()).pathname).toBe('/agent-board/');
  });
});
