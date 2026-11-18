import { expect, test } from '../helpers/fixtures';
import { mainProject, resetBoard } from '../helpers/agboard';
import { resetPreferences, setPreferences } from '../helpers/preferences';
import { openAskAi, fillRequest, requestField, sendRequest } from '../helpers/ask-ai';
import { waitForSync } from '../helpers/ui';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==',
  'base64',
);
const image = (name: string) => ({ name, mimeType: 'image/png', buffer: png });

test.afterEach(() => resetPreferences());

test.beforeEach(async ({ page }) => {
  resetBoard(mainProject);
  await resetPreferences();
  await page.goto('/');
  await waitForSync(page);
});

test('the composer is a title, a borderless field that fills the height, and a toolbar', async ({ page }) => {
  const dialog = await openAskAi(page);
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
  await expect(dialog.getByText('What would you like done?', { exact: true })).toHaveCount(0);
  const field = requestField(dialog);
  const style = await field.evaluate((element) => {
    const css = getComputedStyle(element);
    return { border: css.borderTopWidth, fontSize: parseFloat(css.fontSize) };
  });
  expect(style.border).toBe('0px');
  // 16px or more keeps iOS from zooming in when the field gets the focus.
  expect(style.fontSize).toBeGreaterThanOrEqual(16);
  const send = dialog.getByRole('button', { name: 'Send request' });
  await expect(send).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Image', exact: true })).toBeVisible();
  const fieldBox = await field.boundingBox();
  const toolbarBox = await dialog.locator('.ask-ai__toolbar').boundingBox();
  if (!fieldBox || !toolbarBox) throw new Error('The composer did not render.');
  expect(fieldBox.height).toBeGreaterThan(200);
  expect(fieldBox.y + fieldBox.height).toBeLessThanOrEqual(toolbarBox.y + 1);
  await fillRequest(dialog, 'Make it work');
  await expect(send).toBeEnabled();
});

test('images attach from the picker, a paste and a drop, and show as removable thumbnails', async ({ page }) => {
  const dialog = await openAskAi(page);
  await fillRequest(dialog, 'Investigate image request');
  const picked = dialog.getByRole('button', { name: 'Image', exact: true });
  const chooserPromise = page.waitForEvent('filechooser');
  await picked.click();
  await (await chooserPromise).setFiles(image('picked.png'));
  await expect(dialog.getByRole('button', { name: 'Remove picked.png' })).toBeVisible();

  await requestField(dialog).evaluate((element, base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, png.toString('base64'));
  await expect(dialog.getByRole('button', { name: 'Remove pasted.png' })).toBeVisible();

  await dialog.locator('.ask-ai__body').evaluate((element, base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'dropped.png', { type: 'image/png' }));
    element.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
  }, png.toString('base64'));
  await expect(dialog.getByRole('button', { name: 'Remove dropped.png' })).toBeVisible();

  const thumbs = dialog.locator('.ask-ai__thumb');
  await expect(thumbs).toHaveCount(3);
  const box = await thumbs.first().boundingBox();
  expect(box?.width).toBe(56);
  expect(box?.height).toBe(56);
  await dialog.getByRole('button', { name: 'Remove pasted.png' }).click();
  await expect(thumbs).toHaveCount(2);
  await sendRequest(dialog);
});

test('an image alone enables sending, and the missing text is asked for', async ({ page }) => {
  const dialog = await openAskAi(page);
  await dialog.locator('input[type=file]').setInputFiles(image('only.png'));
  const send = dialog.getByRole('button', { name: 'Send request' });
  await expect(send).toBeEnabled();
  await send.click();
  await expect(dialog.getByRole('alert')).toHaveText('Enter your request.');
  await expect(dialog).toBeVisible();
});

for (const viewport of [{ width: 1280, height: 600 }, { width: 800, height: 500 }, { width: 390, height: 640 }]) {
  test(`the toolbar stays in view at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    // Below 768px the board shows the phone screen, which has no header Ask AI: open the form first, then narrow the window.
    await page.setViewportSize({ width: 1280, height: viewport.height });
    const dialog = await openAskAi(page);
    await page.setViewportSize(viewport);
    await dialog.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
    await fillRequest(dialog, 'Keep all actions accessible');
    await dialog.locator('input[type=file]').setInputFiles(
      Array.from({ length: 5 }, (_, index) => image(`image-${index}.png`)),
    );
    await expect(dialog.getByRole('button', { name: 'Send request' })).toBeInViewport();
    await expect(dialog.getByRole('button', { name: 'Image', exact: true })).toBeInViewport();
    await expect(dialog.getByRole('button', { name: 'Remove image-0.png' })).toBeInViewport();
    await sendRequest(dialog);
  });
}

test('the composer reads well in the dark theme and on a phone', async ({ page }, testInfo) => {
  await setPreferences({ theme: { mode: 'dark', accent: 'blue' } });
  await page.reload();
  await waitForSync(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  const dialog = await openAskAi(page);
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
  await fillRequest(dialog, 'Dark and attached');
  await dialog.locator('input[type=file]').setInputFiles(image('dark.png'));
  await expect(dialog.getByRole('button', { name: 'Remove dark.png' })).toBeVisible();
  await dialog.screenshot({ path: testInfo.outputPath('ask-ai-dark.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  const box = await dialog.boundingBox();
  if (box === null) throw new Error('The composer did not render.');
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  await dialog.screenshot({ path: testInfo.outputPath('ask-ai-dark-phone.png') });
});

test('a refused send keeps the API reason, the text and the images', async ({ page }) => {
  const dialog = await openAskAi(page);
  await fillRequest(dialog, 'Keep my request');
  await dialog.locator('input[type=file]').setInputFiles(image('kept.png'));
  await page.route('**/messages/requests', (route) =>
    route.fulfill({ status: 400, json: { error: { reason: 'The request could not be accepted.' } } }),
  );
  await dialog.getByRole('button', { name: 'Send request' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('The request could not be accepted.');
  await expect(requestField(dialog)).toHaveValue('Keep my request');
  await expect(dialog.getByRole('button', { name: 'Remove kept.png' })).toBeVisible();
});

test('closing with text or an image asks first, and an empty form closes at once', async ({ page }) => {
  let dialog = await openAskAi(page);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);

  dialog = await openAskAi(page);
  await fillRequest(dialog, 'Do not lose this');
  const question = page.getByRole('dialog', { name: 'Discard changes?' });
  for (const close of [
    () => dialog.getByRole('button', { name: 'Close' }).click(),
    () => page.keyboard.press('Escape'),
  ]) {
    await close();
    await expect(question).toBeVisible();
    await question.getByRole('button', { name: 'Keep editing' }).click();
    await expect(question).toHaveCount(0);
    await expect(requestField(dialog)).toHaveValue('Do not lose this');
  }
  await page.keyboard.press('Escape');
  await question.getByRole('button', { name: 'Discard and close' }).click();
  await expect(dialog).toHaveCount(0);

  // An image alone also counts as something to lose.
  dialog = await openAskAi(page);
  await dialog.locator('input[type=file]').setInputFiles(image('only.png'));
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(question).toBeVisible();
  await question.getByRole('button', { name: 'Keep editing' }).click();
  await expect(dialog.getByRole('button', { name: 'Remove only.png' })).toBeVisible();

  // A successful send closes without asking.
  await fillRequest(dialog, 'Send it');
  await sendRequest(dialog);
  await expect(question).toHaveCount(0);
});
