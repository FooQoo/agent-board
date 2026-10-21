import { expect, test, type Page } from '@playwright/test';
import {
  createMonitorHome,
  removeMonitorHome,
  startPhoneEntrance,
  type PhoneEntrance,
} from '../helpers/monitor';

// The PC side of the mobile connection: the settings dialog hands over to the connection dialog,
// the connected view shows the QR code and the passcode, and Reset token and Stop connection lead
// back to the setup. The tunnel is a fake one that opens without any network, so "connected" here
// proves what the PC dialog shows and does, not a real ngrok connection.
test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1280, height: 900 }, locale: 'en-US', timezoneId: 'UTC' });

let home: string;
let entrance: PhoneEntrance;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  home = createMonitorHome();
  entrance = await startPhoneEntrance(home);
});

test.afterAll(async () => {
  await entrance?.stop();
  if (home) removeMonitorHome(home);
});

const status = async (page: Page) =>
  ((await (await page.request.get(`${entrance.pcOrigin}/api/monitor-connections`)).json()) as { status: string }).status;

async function openConnection(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await page.getByRole('button', { name: 'Set up' }).click();
  // The settings dialog closes first: only the connection dialog is on the screen.
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByRole('dialog', { name: 'Mobile connection' })).toBeVisible();
}

test('the settings dialog closes and the connected dialog shows the QR code and the passcode', async ({ page }) => {
  await page.goto(`${entrance.pcOrigin}/`);
  await openConnection(page);
  const dialog = page.getByRole('dialog', { name: 'Mobile connection' });
  await expect(dialog.getByText('Accepting connections')).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Scan the QR code' })).toBeVisible();
  await expect(dialog.getByRole('img', { name: 'QR code for the phone URL' })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Enter the passcode' })).toBeVisible();
  await expect(dialog.getByTestId('passcode')).toHaveText(entrance.passcode);
  await expect(dialog.getByText('Do not share the URL or the passcode with others.')).toBeVisible();
  // The design's size: 680 x 560 (the layout size, which the opening animation does not change).
  expect(await dialog.evaluate((element: HTMLElement) => [element.offsetWidth, element.offsetHeight])).toEqual([680, 560]);
  // Neither a domain field nor the old advanced settings exist.
  await expect(dialog.getByLabel(/domain/i)).toHaveCount(0);
  await expect(dialog.getByText(/advanced|Protected by a passcode/i)).toHaveCount(0);
});

test('Reset token shows the setup without stopping, and closing the dialog keeps the connection', async ({ page }) => {
  await page.goto(`${entrance.pcOrigin}/`);
  await openConnection(page);
  const dialog = page.getByRole('dialog', { name: 'Mobile connection' });
  await dialog.getByRole('button', { name: 'Reset token' }).click();
  await expect(dialog.getByText('Not connected')).toBeVisible();
  await expect(dialog.getByLabel('ngrok auth token')).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Open the token page' })).toHaveAttribute('target', '_blank');
  expect(await status(page)).toBe('ready');
  // Closing the dialog returns the focus to the settings button and leaves the connection on.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Settings' })).toBeFocused();
  expect(await status(page)).toBe('ready');
  await openConnection(page);
  await expect(page.getByRole('dialog', { name: 'Mobile connection' }).getByText('Accepting connections')).toBeVisible();
});

test('Stop connection returns to the setup, and Save and connect connects again with the saved token', async ({ page }) => {
  await page.goto(`${entrance.pcOrigin}/`);
  await openConnection(page);
  const dialog = page.getByRole('dialog', { name: 'Mobile connection' });
  await dialog.getByRole('button', { name: 'Stop connection' }).click();
  await expect(dialog.getByText('Not connected')).toBeVisible();
  await expect(dialog.getByLabel('ngrok auth token')).toBeVisible();
  await expect(dialog.getByTestId('passcode')).toHaveCount(0);
  expect(await status(page)).toBe('disabled');
  // The token of the environment is enough: an empty field connects again, with a passcode of its own.
  await dialog.getByRole('button', { name: 'Save and connect' }).click();
  await expect(dialog.getByText('Accepting connections')).toBeVisible();
  await expect(dialog.getByTestId('passcode')).toHaveText(/^\d{4}$/);
  expect(await status(page)).toBe('ready');
});
