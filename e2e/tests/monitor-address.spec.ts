import { expect, test, type Page } from '@playwright/test';
import { createMonitorHome, monitorProjectId, removeMonitorHome, startPhoneEntrance, type PhoneEntrance } from '../helpers/monitor';

// The phone's first visit through ngrok's warning page (free plan). "Visit Site" sets a cookie on
// the directory of the address, so the monitor's scripts and stylesheet must sit under /monitor/ to
// receive it. Files outside that path come back as the warning page, which leaves the monitor blank.
// The warning is emulated by the phone entrance; see helpers/phone-entrance.mjs.
test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 390, height: 844 }, locale: 'en-US', timezoneId: 'UTC' });

let home: string;
let alpha: string;
let entrance: PhoneEntrance;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  home = createMonitorHome();
  alpha = monitorProjectId(home, 'Alpha');
  entrance = await startPhoneEntrance(home, { warning: true });
});

test.afterAll(async () => {
  await entrance?.stop();
  if (home) removeMonitorHome(home);
});

/** The scripts and stylesheets that the page received as HTML instead of their own type. */
function warnedFiles(page: Page): string[] {
  const warned: string[] = [];
  page.on('response', (response) => {
    const kind = response.request().resourceType();
    const type = response.headers()['content-type'] ?? '';
    if ((kind === 'script' || kind === 'stylesheet') && type.includes('text/html')) warned.push(response.url());
  });
  return warned;
}

test('a direct link to the monitor shows the passcode after Visit Site, and its scripts and stylesheets load', async ({ page }) => {
  const warned = warnedFiles(page);
  await page.goto(`${entrance.phoneOrigin}/monitor/?project=${alpha}`);
  await page.getByRole('button', { name: 'Visit Site' }).click();
  await expect(page.locator('#monitor-passcode')).toBeVisible();
  // The logo is inlined in the monitor's bundle, so it loads with the page.
  const logo = page.locator('.header__logo img');
  await expect(logo).toHaveJSProperty('complete', true);
  expect(await logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  expect(warned).toEqual([]);
});

test('the bare address leads to the page that asks for the QR code again, and its scripts and stylesheets load', async ({ page }) => {
  // The bare address forwards to /monitor/ without a project: the monitor says so and shows no list.
  const warned = warnedFiles(page);
  await page.goto(entrance.phoneOrigin);
  await page.getByRole('button', { name: 'Visit Site' }).click();
  await expect(page.getByRole('alert')).toContainText('This link has no project');
  await expect(page.getByRole('alert')).toContainText('scan the QR code again');
  const logo = page.locator('.header__logo img');
  await expect(logo).toHaveJSProperty('complete', true);
  expect(await logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  expect(warned).toEqual([]);
});
