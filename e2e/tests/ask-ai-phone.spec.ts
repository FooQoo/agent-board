import { expect, test } from '../helpers/fixtures';
import { mainProject, resetBoard } from '../helpers/agboard';
import { resetPreferences } from '../helpers/preferences';
import { requestField } from '../helpers/ask-ai';

// An iPhone-sized touch screen. Chromium stands in for Safari here: see the note in the test.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test.afterEach(() => resetPreferences());

test.beforeEach(async () => {
  resetBoard(mainProject);
  await resetPreferences();
});

test('the sheet keeps its toolbar above the keyboard and its field at 16px', async ({ page }, testInfo) => {
  // iOS Safari leaves the layout viewport at full height and only shrinks the visual viewport when
  // the keyboard opens; a stand-in for it lets the test play that.
  await page.addInitScript(() => {
    const target = new EventTarget();
    const state = { shrink: 0, offsetTop: 0 };
    const page = () => document.documentElement;
    const fake = Object.defineProperties(target, {
      height: { get: () => page().clientHeight - state.shrink },
      offsetTop: { get: () => state.offsetTop },
      width: { get: () => page().clientWidth },
    });
    Object.defineProperty(window, 'visualViewport', { value: fake, configurable: true });
    (window as unknown as { setKeyboard: (height: number) => void }).setKeyboard = (height) => {
      state.shrink = height;
      target.dispatchEvent(new Event('resize'));
    };
  });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Messages' })).toBeVisible();
  await page.getByRole('region', { name: 'Messages' }).getByRole('button', { name: 'Ask AI' }).click();
  const sheet = page.getByRole('dialog', { name: 'Ask AI' });
  await expect(sheet).toBeVisible();
  const field = requestField(sheet);
  expect(await field.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
  const send = sheet.getByRole('button', { name: 'Send request' });
  await expect(send).toBeInViewport({ ratio: 1 });
  // Measure only once the sheet has stopped moving (its slide-in, or the visual viewport settling).
  const settle = () =>
    expect(async () => {
      const first = await sheet.boundingBox();
      await page.waitForTimeout(100);
      expect(await sheet.boundingBox()).toEqual(first);
    }).toPass();
  // Positions and sizes are compared with 2px of room for subpixel rounding.
  const tolerance = 2;
  await settle();
  const closed = await sheet.boundingBox();

  await page.evaluate(() => (window as unknown as { setKeyboard: (height: number) => void }).setKeyboard(336));
  await expect.poll(async () => (await send.boundingBox())?.y ?? 0).toBeLessThan(844 - 336);
  await settle();
  const box = await send.boundingBox();
  const opened = await sheet.boundingBox();
  if (!box || !opened || !closed) throw new Error('The sheet did not render.');
  if (process.env.AB_SHOTS) await page.screenshot({ path: `${process.env.AB_SHOTS}/keyboard-open.png` });
  // The toolbar ends above the keyboard, and the sheet still shows its title.
  expect(box.y + box.height).toBeLessThanOrEqual(844 - 336 + tolerance);
  expect(opened.y).toBeGreaterThanOrEqual(-tolerance);
  expect(opened.y + opened.height).toBeLessThanOrEqual(844 - 336 + tolerance);
  // The sheet keeps the chrome it has without the keyboard: the same height of header, the drag
  // handle, and the toolbar, and only the field shrinks.
  await expect(sheet.locator('.mobile-drawer__handle')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Close', exact: true })).toBeInViewport({ ratio: 1 });
  const title = sheet.locator('.mobile-drawer__title');
  await expect(title).toBeInViewport({ ratio: 1 });
  expect(opened.y).toBeGreaterThanOrEqual(44 - tolerance);
  expect(opened.height).toBeLessThan(closed.height - tolerance);
  const fieldBox = await field.boundingBox();
  expect(fieldBox?.height ?? 0).toBeGreaterThanOrEqual(150 - tolerance);
  // Under the sheet, down to the keyboard, the sheet's own color is painted: the strip is one flat
  // color (the board's cards would make two strips differ), and the sheet carries the extension.
  expect(await sheet.evaluate((el) => getComputedStyle(el).boxShadow)).toContain('336px');
  const sheetBottom = opened.y + opened.height;
  const strip = (y: number) => page.screenshot({ clip: { x: 8, y, width: 374, height: 12 } });
  const near = await strip(sheetBottom + 40);
  const far = await strip(sheetBottom + 40 + 150);
  expect(near.equals(far)).toBe(true);
  await sheet.screenshot({ path: testInfo.outputPath('ask-ai-sheet-keyboard.png') });

  await page.evaluate(() => (window as unknown as { setKeyboard: (height: number) => void }).setKeyboard(0));
  // Back where it was, give or take the subpixel rounding of the visual viewport.
  await expect.poll(async () => Math.abs(((await sheet.boundingBox())?.y ?? 0) - closed.y)).toBeLessThanOrEqual(tolerance);
});

test('closing the sheet with text asks first, and an empty sheet closes at once', async ({ page }) => {
  await page.goto('/');
  const open = async () => {
    await page.getByRole('region', { name: 'Messages' }).getByRole('button', { name: 'Ask AI' }).click();
    const sheet = page.getByRole('dialog', { name: 'Ask AI' });
    await expect(sheet).toBeVisible();
    return sheet;
  };
  let sheet = await open();
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(sheet).toHaveCount(0);

  sheet = await open();
  await requestField(sheet).fill('Keep this on the phone');
  const question = page.getByRole('dialog', { name: 'Discard changes?' });
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(question).toBeVisible();
  await question.getByRole('button', { name: 'Keep editing' }).click();
  await expect(requestField(sheet)).toHaveValue('Keep this on the phone');
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  await question.getByRole('button', { name: 'Discard and close' }).click();
  await expect(sheet).toHaveCount(0);
});
