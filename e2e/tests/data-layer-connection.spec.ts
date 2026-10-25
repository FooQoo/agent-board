import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../helpers/agboard';
import {
  createMonitorHome,
  monitorProjectId,
  removeMonitorHome,
  startPhoneEntrance,
  type PhoneEntrance,
} from '../helpers/monitor';

// The PC connection dialog gives one address per project: the QR code and the copied URL are the
// same `/monitor/?project={projectId}`. The QR code is decoded in the page with the jsQR build that
// the web app already ships, so the test reads the code the way a phone camera does. The tunnel is
// the fake one of the phone entrance: no network is used.
test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1280, height: 900 }, locale: 'en-US', timezoneId: 'UTC' });

const jsQrSource = readFileSync(path.join(repoRoot, 'web', 'node_modules', 'jsqr', 'dist', 'jsQR.js'), 'utf8');

let home: string;
let entrance: PhoneEntrance;
let alpha: string;

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

async function openConnection(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Connection settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Mobile connection' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** The clipboard is replaced by a record of what the page writes to it. */
async function recordCopies(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as unknown as { __copied?: string }).__copied = text;
        },
      },
    });
  });
}

const copied = (page: Page) =>
  page.evaluate(() => (window as unknown as { __copied?: string }).__copied ?? null);

/** Reads the QR image in the page: the picture is drawn on a white ground, then decoded. */
async function decodeQr(page: Page, image: Locator): Promise<string | null> {
  const src = await image.getAttribute('src');
  expect(src).toMatch(/^data:image\/svg\+xml/);
  await page.evaluate(jsQrSource);
  return page.evaluate(async (dataUrl: string) => {
    const picture = new Image(360, 360);
    picture.src = dataUrl;
    await picture.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 440;
    canvas.height = 440;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, 440, 440);
    context.drawImage(picture, 40, 40, 360, 360);
    const pixels = context.getImageData(0, 0, 440, 440);
    const jsQR = (window as unknown as {
      jsQR: (data: Uint8ClampedArray, width: number, height: number) => { data: string } | null;
    }).jsQR;
    return jsQR(pixels.data, pixels.width, pixels.height)?.data ?? null;
  }, src ?? '');
}

test('the QR code and the copied URL are the same address, with the selected project', async ({ page }) => {
  await recordCopies(page);
  await page.goto(`${entrance.pcOrigin}/?project=${alpha}`);
  const dialog = await openConnection(page);
  await expect(dialog.getByTestId('passcode')).toHaveText(entrance.passcode);
  const qr = dialog.getByRole('img', { name: 'QR code for the phone URL' });
  await expect(qr).toBeVisible();
  const encoded = await decodeQr(page, qr);
  expect(encoded).not.toBeNull();

  await dialog.getByRole('button', { name: 'Copy URL' }).click();
  await expect.poll(() => copied(page)).toBe(encoded);

  // The address is the public origin the connection reports, the monitor path and the project.
  const status = (await (await page.request.get(`${entrance.pcOrigin}/api/monitor-connections`)).json()) as {
    url: string;
  };
  const address = new URL(encoded ?? '');
  expect(address.origin).toBe(new URL(status.url).origin);
  expect(address.pathname).toBe('/monitor/');
  expect(address.search).toBe(`?project=${alpha}`);
});

test('without a selected project there is no QR code and the copy is off', async ({ page }) => {
  await recordCopies(page);
  // An empty project query: the board has no project selected.
  await page.goto(`${entrance.pcOrigin}/?project=`);
  const dialog = await openConnection(page);
  await expect(dialog.getByText('Accepting connections')).toBeVisible();
  await expect(dialog.getByTestId('project-needed')).toHaveText(
    'Select a project on the board to show its QR code and URL.',
  );
  await expect(dialog.getByRole('img', { name: 'QR code for the phone URL' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Copy URL' })).toBeDisabled();
  // The passcode of the running connection is still shown.
  await expect(dialog.getByTestId('passcode')).toHaveText(entrance.passcode);
  expect(await copied(page)).toBeNull();
});
