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
  const closed = await sheet.boundingBox();

  await page.evaluate(() => (window as unknown as { setKeyboard: (height: number) => void }).setKeyboard(336));
  await expect.poll(async () => (await send.boundingBox())?.y ?? 0).toBeLessThan(844 - 336);
  const box = await send.boundingBox();
  const opened = await sheet.boundingBox();
  if (!box || !opened || !closed) throw new Error('The sheet did not render.');
  // The toolbar ends above the keyboard, and the sheet still shows its title.
  expect(box.y + box.height).toBeLessThanOrEqual(844 - 336);
  expect(opened.y).toBeGreaterThanOrEqual(0);
  expect(opened.y + opened.height).toBeLessThanOrEqual(844 - 336 + 1);
  await sheet.screenshot({ path: testInfo.outputPath('ask-ai-sheet-keyboard.png') });

  await page.evaluate(() => (window as unknown as { setKeyboard: (height: number) => void }).setKeyboard(0));
  await expect.poll(async () => Math.round((await sheet.boundingBox())?.y ?? 0)).toBe(Math.round(closed.y));
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
