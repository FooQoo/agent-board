import { expect, test, type Locator } from '../helpers/fixtures';
import { mainProject, resetBoard } from '../helpers/agboard';
import { resetPreferences, setPreferences } from '../helpers/preferences';
import { openAskAi, fillRequest, requestField, sendRequest } from '../helpers/ask-ai';
import { editorValue, waitForSync } from '../helpers/ui';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==',
  'base64',
);

test.afterEach(() => resetPreferences());

test.beforeEach(async ({ page }) => {
  resetBoard(mainProject);
  await resetPreferences();
  await page.goto('/');
  await waitForSync(page);
});

test('the Ask AI text field leaves room for its complete focus ring', async ({ page }, testInfo) => {
  const dialog = await openAskAi(page);
  const textarea = requestField(dialog);
  await fillRequest(dialog, 'Keep the focused border visible');
  await expect(textarea).toBeFocused();
  // The editor's box sits inside the dialog body with room for its focus ring on both sides.
  const margins = await textarea.evaluate((element) => {
    const field = (element.closest('.editor__box') ?? element).getBoundingClientRect();
    const body = element.closest('.modal__body')?.getBoundingClientRect();
    if (!body) throw new Error('The request form did not render.');
    return { left: field.left - body.left, right: body.right - field.right };
  });
  expect(margins.left).toBeGreaterThanOrEqual(2);
  expect(margins.right).toBeGreaterThanOrEqual(2);
  await dialog.screenshot({ path: testInfo.outputPath('request-focused-border.png') });
});

test('request actions share a button height and keep the footer concise', async ({ page }) => {
  for (const width of [1280, 390]) {
    // Below 768px the board shows the phone screen, which has no header Ask AI: open the form first, then narrow the window.
    await page.setViewportSize({ width: 1280, height: 844 });
    const dialog = await openAskAi(page);
    await page.setViewportSize({ width, height: 844 });
    await dialog.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
    const sizes = await dialog.locator('.modal__footer button').evaluateAll((buttons) => buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return { height: box.height, width: box.width };
    }));
    expect(sizes).toHaveLength(2);
    for (const size of sizes) expect(size.height).toBeCloseTo(sizes[0].height, 1);
    if (width === 390) {
      for (const size of sizes) expect(size.width).toBeCloseTo(sizes[0].width, 1);
    }
    await expect(dialog.locator('.ask-ai__note')).toHaveText('A sent request shows as "Waiting to be picked up" until an AI receives it.');
    await expect(dialog.getByRole('button', { name: 'Send request', exact: true })).toBeInViewport();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
});

test('request attachment headings use the same typography as the other field labels', async ({ page }) => {
  const dialog = await openAskAi(page);
  const styles = await dialog.locator('.ask-ai__label, [data-slot=label]').evaluateAll((labels) => labels.map((label) => {
    const style = getComputedStyle(label);
    return { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight, line: style.lineHeight };
  }));
  expect(styles).toHaveLength(2);
  // The field prompt is 14px and the attachment heading is 12px; the family and weight are shared.
  expect(styles[1].family).toBe(styles[0].family);
  expect(styles[1].weight).toBe(styles[0].weight);
});

test('the image picker stays square at the left without resizing the request dialog', async ({ page }, testInfo) => {
  for (const { mode, width } of [{ mode: 'light', width: 1280 }, { mode: 'dark', width: 1280 }, { mode: 'light', width: 390 }, { mode: 'dark', width: 390 }]) {
    // Below 768px the board shows the phone screen, which has no header Ask AI: open the form first, then narrow the window.
    await page.setViewportSize({ width: 1280, height: 1100 });
    await setPreferences({ theme: { mode: mode as 'light' | 'dark', accent: 'blue' } });
    await page.reload();
    await waitForSync(page);
    const dialog = await openAskAi(page);
    await page.setViewportSize({ width, height: 1100 });
    await dialog.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
    const initial = await dialog.boundingBox();
    const textarea = requestField(dialog);
    await textarea.focus();
    expect(await textarea.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('none');
    await dialog.screenshot({ path: testInfo.outputPath(`request-empty-focus-${mode}.png`) });
    await fillRequest(dialog, 'Stable image tray');
    const add = dialog.getByRole('button', { name: 'Add image attachment', exact: true });
    const emptyPicker = await add.boundingBox();
    const chooserPromise = page.waitForEvent('filechooser');
    await add.click();
    const chooser = await chooserPromise;
    await chooser.setFiles(Array.from({ length: 6 }, (_, index) => ({ name: `tray-${index}.png`, mimeType: 'image/png', buffer: png })));
    const attached = await dialog.boundingBox();
    if (initial === null || attached === null) throw new Error('The request dialog did not render.');
    // The dialog's width stays put; it may grow taller by the height of the image row (the editor box has a fixed height).
    expect(Math.abs(initial.width - attached.width)).toBeLessThan(1);
    const size = await add.boundingBox();
    if (size === null) throw new Error('The image picker did not render.');
    expect(size.width).toBe(size.height);
    if (!emptyPicker) throw new Error('The empty image picker did not render.');
    expect(size.y).toBeCloseTo(emptyPicker.y, 1);
    const preview = await dialog.locator('.editor-attachments__preview').first().boundingBox();
    if (!preview) throw new Error('The image preview did not render.');
    expect(preview.y).toBeCloseTo(size.y, 1);
    expect(preview.width).toBeCloseTo(size.width, 1);
    expect(preview.height).toBeCloseTo(size.height, 1);
    const unusedSpace = await dialog.locator('.modal__body').evaluate((body) => {
      const hint = body.querySelector('.editor-attachments__hint');
      if (!hint) throw new Error('The attachment hint did not render.');
      return body.getBoundingClientRect().bottom - hint.getBoundingClientRect().bottom;
    });
    expect(unusedSpace).toBeLessThan(24);
    await dialog.locator('.editor-attachments__list').evaluate((list) => { list.scrollLeft = list.scrollWidth; });
    await expect(add).toBeInViewport();
    const left = await add.evaluate((button) => button.getBoundingClientRect().left - (button.parentElement?.getBoundingClientRect().left ?? 0));
    expect(left).toBeLessThanOrEqual(5);
    await dialog.screenshot({ path: testInfo.outputPath(`request-image-tray-${mode}.png`) });
    await dialog.getByRole('button', { name: 'Remove tray-5.png' }).click();
    await expect(dialog.locator('.editor-attachments__tile')).toHaveCount(5);
    await sendRequest(dialog);
  }
});

for (const viewport of [{ width: 1280, height: 600 }, { width: 800, height: 500 }, { width: 390, height: 640 }]) {
  test(`request fields scroll without hiding actions at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    // Below 768px the board shows the phone screen, which has no header Ask AI: open the form first, then narrow the window.
    await page.setViewportSize({ width: 1280, height: viewport.height });
    const dialog = await openAskAi(page);
    await page.setViewportSize(viewport);
    await fillRequest(dialog, 'Keep all actions accessible');
    await dialog.locator('input[type=file]').setInputFiles(
      Array.from({ length: 5 }, (_, index) => ({ name: `image-${index}.png`, mimeType: 'image/png', buffer: png })),
    );
    const submit = dialog.getByRole('button', { name: 'Send request' });
    await expect(submit).toBeInViewport();
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
    await dialog.locator('.modal__body').evaluate((body) => { body.scrollTop = body.scrollHeight; });
    await expect(dialog.getByRole('button', { name: 'Preview image-0.png' })).toBeInViewport();
    await expect(submit).toBeInViewport();
    const size = await dialog.locator('.editor-attachments__preview').first().boundingBox();
    if (size === null) throw new Error('The image preview did not render.');
    expect(size.height).toBeGreaterThanOrEqual(100);
    expect(Math.abs(size.height - size.width)).toBeLessThan(2);
    await dialog.screenshot({ path: testInfo.outputPath('request-scroll-and-actions.png') });
    await sendRequest(dialog);
  });
}

test('Ask AI dialog attachments stay visible and operable on desktop, dark, and mobile', async ({
  page,
}, testInfo) => {
  const openRequest = async () => {
    const dialog = await openAskAi(page);
    await page.waitForTimeout(250);
    return dialog;
  };
  const attach = async (dialog: Locator, name: string) => {
    await dialog
      .locator('input[type=file]')
      .setInputFiles({ name, mimeType: 'image/png', buffer: png });
    await expect(dialog.getByRole('button', { name: `Preview ${name}` })).toBeVisible();
    await expect(dialog.getByText(name, { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: `Remove ${name}` })).toBeVisible();
    await expect
      .poll(() =>
        dialog
          .locator('.editor-attachments__preview img')
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBe(1);
  };

  await page.setViewportSize({ width: 1280, height: 900 });
  let dialog = await openRequest();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await dialog.screenshot({ path: testInfo.outputPath('request-light-empty.png') });
  await attach(dialog, 'shared-notes.png');
  const list = dialog.locator('.editor-attachments__list');
  const tile = dialog.locator('.editor-attachments__tile');
  const listBox = await list.boundingBox();
  const tileBox = await tile.boundingBox();
  if (listBox === null || tileBox === null) throw new Error('The attachment list did not render.');
  expect(listBox.height).toBeGreaterThan(0);
  expect(listBox.height + 1).toBeGreaterThanOrEqual(tileBox.height);
  await dialog.screenshot({ path: testInfo.outputPath('request-light-attached.png') });

  await dialog.getByRole('button', { name: 'Preview shared-notes.png' }).click();
  await expect(page.getByRole('dialog', { name: 'shared-notes.png' })).toBeVisible();
  await page.locator('.lightbox__close').click();
  await expect(dialog.getByRole('button', { name: 'Remove shared-notes.png' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove shared-notes.png' }).click();
  await expect(dialog.locator('.editor-attachments__tile')).toHaveCount(0);

  await setPreferences({ theme: { mode: 'dark', accent: 'blue' } });
  await page.reload();
  await waitForSync(page);
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
  dialog = await openRequest();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await dialog.screenshot({ path: testInfo.outputPath('request-dark-empty.png') });

  // Below 768px the board shows the phone screen, which has no header Ask AI: open the form first, then narrow the window.
  await page.reload();
  await waitForSync(page);
  dialog = await openRequest();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await dialog.screenshot({ path: testInfo.outputPath('request-mobile-empty.png') });
  await attach(dialog, 'mobile-notes.png');
  await expect(dialog.getByRole('button', { name: 'Remove mobile-notes.png' })).toBeInViewport();
  const mobileBox = await dialog.boundingBox();
  if (mobileBox === null) throw new Error('The mobile request dialog did not render.');
  expect(mobileBox.y + mobileBox.height).toBeLessThanOrEqual(844);
  await dialog.screenshot({ path: testInfo.outputPath('request-mobile-attached.png') });
  const submit = dialog.getByRole('button', { name: 'Send request' });
  await submit.scrollIntoViewIfNeeded();
  await expect(submit).toBeInViewport();
});

test('Ask AI requests accept pasted images in the text field and keep multiple square previews compact', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const dialog = await openAskAi(page);
  const textarea = requestField(dialog);
  await fillRequest(dialog, 'Investigate image request');
  await textarea.evaluate((element, base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, png.toString('base64'));
  await expect(dialog.getByRole('button', { name: 'Preview pasted.png' })).toBeVisible();
  await dialog.locator('input[type=file]').setInputFiles([
    { name: 'second.png', mimeType: 'image/png', buffer: png },
    { name: 'third.png', mimeType: 'image/png', buffer: png },
  ]);

  const tiles = dialog.locator('.editor-attachments__tile');
  await expect(tiles).toHaveCount(3);
  const first = await tiles.nth(0).boundingBox();
  const second = await tiles.nth(1).boundingBox();
  const preview = await tiles.nth(0).locator('.editor-attachments__preview').boundingBox();
  if (first === null || second === null || preview === null) throw new Error('Previews did not render.');
  expect(Math.abs(first.y - second.y)).toBeLessThan(2);
  expect(Math.abs(preview.width - preview.height)).toBeLessThan(2);
  await expect(dialog.getByRole('button', { name: 'Send request' })).toBeInViewport();

  await sendRequest(dialog);
});

test('Ask AI request save errors retain the API reason and keep text and images', async ({ page }) => {
  await page.goto('/');
  await waitForSync(page);
  const dialog = await openAskAi(page);
  await fillRequest(dialog, 'Keep my request');
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'kept.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await page.route('**/messages/requests', (route) =>
    route.fulfill({ status: 400, json: { error: { reason: 'The request could not be accepted.' } } }),
  );
  // The editor hands its text to the form a moment after a paste: the click is repeated until the refusal shows.
  await expect(async () => {
    await dialog.getByRole('button', { name: 'Send request' }).click({ timeout: 2000 });
    await expect(dialog.getByRole('alert')).toHaveText('The request could not be accepted.', { timeout: 2000 });
  }).toPass({ timeout: 10_000 });
  expect(await editorValue(requestField(dialog))).toContain('Keep my request');
  await expect(dialog.getByRole('button', { name: 'Remove kept.png' })).toBeVisible();
});
