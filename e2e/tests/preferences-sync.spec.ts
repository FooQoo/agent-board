import { expect, test, type Page } from '@playwright/test';
import { mainOrigin } from '../helpers/agboard';
import {
  createMonitorHome,
  monitorProjectId,
  removeMonitorHome,
  startPhoneEntrance,
  type PhoneEntrance,
} from '../helpers/monitor';
import { getPreferences, resetPreferences, setPreferences } from '../helpers/preferences';

// The saved language and color theme belong to the PC and are shared by every screen. E-1 is the PC in two
// browsers, E-2 is the PC page and the phone monitor open together, and E-3 is a phone that has never
// opened the monitor. The monitor runs behind the ngrok entrance stand-in (see helpers/phone-entrance.mjs);
// its backend also serves the PC page, over the same data area, so both screens share one saved setting.
test.describe.configure({ mode: 'serial' });

let home: string;
let alpha: string;
let entrance: PhoneEntrance;

const monitorUrl = () => `${entrance.phoneOrigin}/monitor/?project=${alpha}`;
const html = (page: Page) => page.locator('html');

test.beforeAll(async () => {
  test.setTimeout(240_000);
  home = createMonitorHome();
  alpha = monitorProjectId(home, 'Alpha');
  entrance = await startPhoneEntrance(home);
});

test.afterAll(async () => {
  await entrance?.stop();
  if (home) removeMonitorHome(home);
});

// The main serve for E-1 and the backend of the monitor each keep their own saved setting.
test.beforeEach(async () => {
  await resetPreferences(mainOrigin);
  await resetPreferences(entrance.pcOrigin);
});

test.afterEach(async () => {
  await resetPreferences(mainOrigin);
  await resetPreferences(entrance.pcOrigin);
});

async function choose(page: Page, dialogName: string, option: string): Promise<void> {
  await page.getByRole('button', { name: dialogName }).click();
  const dialog = page.getByRole('dialog', { name: dialogName });
  await dialog.getByRole('radio', { name: option, exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function expectLook(page: Page, lang: string, mode: string, accent: string): Promise<void> {
  await expect(html(page)).toHaveAttribute('lang', lang);
  await expect(html(page)).toHaveAttribute('data-mode', mode);
  await expect(html(page)).toHaveAttribute('data-accent', accent);
}

test('E-1: a language and theme chosen in one PC browser open the same in a browser with empty storage', async ({
  browser,
}) => {
  const contextA = await browser.newContext({ baseURL: `${mainOrigin}/` });
  const contextB = await browser.newContext({ baseURL: `${mainOrigin}/` });
  try {
    const a = await contextA.newPage();
    await a.goto('/');
    await expect(a.getByRole('contentinfo').getByRole('status')).toHaveText(/^Synced/);
    await choose(a, 'Settings', 'Dark Teal');
    await choose(a, 'Settings', '日本語');
    await expectLook(a, 'ja', 'dark', 'teal');
    // The server holds the choice.
    await expect.poll(async () => getPreferences(mainOrigin)).toMatchObject({
      locale: 'ja',
      theme: { mode: 'dark', accent: 'teal' },
    });

    // Another browser: its storage has never held anything.
    const b = await contextB.newPage();
    await b.addInitScript(() => {
      (window as unknown as Record<string, number>).__storageAtStart = localStorage.length;
    });
    await b.goto('/');
    expect(await b.evaluate(() => (window as unknown as Record<string, number>).__storageAtStart)).toBe(0);
    await expect(b.getByRole('contentinfo').getByRole('status')).toHaveText(/^同期済み/);
    await expectLook(b, 'ja', 'dark', 'teal');
    await expect(b.getByRole('button', { name: '設定' })).toBeVisible();
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('E-2: a change on the phone monitor reaches the PC page, and a change on the PC reaches the monitor, without a reload', async ({
  browser,
  page: pc,
}) => {
  const phoneContext = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'en-US', timezoneId: 'UTC' });
  try {
    await pc.goto(`${entrance.pcOrigin}/`);
    await expect(pc.getByRole('contentinfo').getByRole('status')).toHaveText(/^Synced/);
    await expectLook(pc, 'en', 'light', 'blue');
    const phone = await phoneContext.newPage();
    await entrance.open(phone, monitorUrl());
    await expect(phone.getByRole('status')).toContainText('Connected');
    await expectLook(phone, 'en', 'light', 'blue');

    // Neither page may reload: a marker on each window must survive.
    await pc.evaluate(() => { (window as unknown as Record<string, number>).__kept = 1; });
    await phone.evaluate(() => { (window as unknown as Record<string, number>).__kept = 1; });

    // Phone to PC: the language, then the theme.
    await choose(phone, 'Settings', '日本語');
    await expect(html(phone)).toHaveAttribute('lang', 'ja');
    await expect(html(pc)).toHaveAttribute('lang', 'ja');
    await choose(phone, '設定', 'ダーク・オレンジ');
    await expectLook(pc, 'ja', 'dark', 'orange');
    expect(await getPreferences(entrance.pcOrigin)).toMatchObject({ locale: 'ja', theme: { mode: 'dark', accent: 'orange' } });

    // PC to phone: the language, then the theme.
    await choose(pc, '設定', 'English');
    await expect(html(pc)).toHaveAttribute('lang', 'en');
    await expect(html(phone)).toHaveAttribute('lang', 'en');
    await choose(pc, 'Settings', 'Light Pink');
    await expectLook(phone, 'en', 'light', 'pink');
    await expectLook(pc, 'en', 'light', 'pink');

    expect(await pc.evaluate(() => (window as unknown as Record<string, number>).__kept)).toBe(1);
    expect(await phone.evaluate(() => (window as unknown as Record<string, number>).__kept)).toBe(1);
  } finally {
    await phoneContext.close();
  }
});

test('E-3: a phone with empty storage opens the monitor in the language and theme saved on the PC', async ({ browser }) => {
  await setPreferences({ locale: 'ja', theme: { mode: 'dark', accent: 'teal' } }, entrance.pcOrigin);
  const phoneContext = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'en-US', timezoneId: 'UTC' });
  try {
    const phone = await phoneContext.newPage();
    await entrance.open(phone, monitorUrl());
    await expect(phone.getByRole('article', { name: /Alpha pending review/ })).toBeVisible();
    await expectLook(phone, 'ja', 'dark', 'teal');
    await expect(phone.getByRole('button', { name: '設定' })).toBeVisible();
    await expect(phone.getByRole('status')).toContainText('接続中');
  } finally {
    await phoneContext.close();
  }
});
