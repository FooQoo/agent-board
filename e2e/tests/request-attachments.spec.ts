import { expect, test, type Locator } from '@playwright/test';
import { mainProject, resetBoard } from '../helpers/agboard';
import { waitForSync } from '../helpers/ui';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==',
  'base64',
);

test.beforeEach(async ({ page }) => {
  resetBoard(mainProject);
  await page.goto('/');
  await waitForSync(page);
});

test('the request text field leaves room for its complete focus ring', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: 'Add task' }).click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  const textarea = dialog.getByRole('textbox', { name: 'What should be done?' });
  await textarea.fill('Keep the focused border visible');
  await expect(textarea).toBeFocused();
  const margins = await textarea.evaluate((element) => {
    const field = element.getBoundingClientRect();
    const form = element.closest('form')?.getBoundingClientRect();
    if (!form) throw new Error('The request form did not render.');
    return { left: field.left - form.left, right: form.right - field.right };
  });
  expect(margins.left).toBeGreaterThanOrEqual(2);
  expect(margins.right).toBeGreaterThanOrEqual(2);
  await dialog.screenshot({ path: testInfo.outputPath('request-focused-border.png') });
});

test('request actions share a button height and keep the footer concise', async ({ page }) => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('button', { name: 'Add task' }).click();
    const dialog = page.getByRole('dialog', { name: 'New task' });
    await dialog.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
    const sizes = await dialog.locator('.modal__footer button').evaluateAll((buttons) => buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return { height: box.height, width: box.width };
    }));
    expect(sizes).toHaveLength(3);
    for (const size of sizes) expect(size.height).toBeCloseTo(sizes[0].height, 1);
    if (width === 390) {
      for (const size of sizes) expect(size.width).toBeCloseTo(sizes[0].width, 1);
    }
    await expect(dialog.locator('.request-dialog__note')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Create manually' })).toBeInViewport();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
});

test('request attachment headings use the same typography as the other field labels', async ({ page }) => {
  await page.getByRole('button', { name: 'Add task' }).click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  const styles = await dialog.locator('[data-slot=label]').evaluateAll((labels) => labels.map((label) => {
    const style = getComputedStyle(label);
    return { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight, line: style.lineHeight };
  }));
  expect(styles).toHaveLength(3);
  expect(styles[1]).toEqual(styles[0]);
  expect(styles[2]).toEqual(styles[0]);
});

test('the image picker stays square at the left without resizing the request dialog', async ({ page }, testInfo) => {
  for (const mode of ['light', 'dark']) {
    await page.evaluate((value) => localStorage.setItem('agboard.theme', JSON.stringify({ mode: value, accent: 'blue' })), mode);
    await page.reload();
    await waitForSync(page);
    await page.getByRole('button', { name: 'Add task' }).click();
    const dialog = page.getByRole('dialog', { name: 'New task' });
    await dialog.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
    const initial = await dialog.boundingBox();
    const textarea = dialog.getByRole('textbox', { name: 'What should be done?' });
    await textarea.focus();
    await expect(textarea).toHaveAttribute('aria-invalid', 'false');
    expect(await textarea.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('none');
    await dialog.screenshot({ path: testInfo.outputPath(`request-empty-focus-${mode}.png`) });
    await textarea.fill('Stable image tray');
    const add = dialog.getByRole('button', { name: 'Add image attachment', exact: true });
    const chooserPromise = page.waitForEvent('filechooser');
    await add.click();
    const chooser = await chooserPromise;
    await chooser.setFiles(Array.from({ length: 6 }, (_, index) => ({ name: `tray-${index}.png`, mimeType: 'image/png', buffer: png })));
    const attached = await dialog.boundingBox();
    if (initial === null || attached === null) throw new Error('The request dialog did not render.');
    expect(Math.abs(initial.height - attached.height)).toBeLessThan(1);
    const size = await add.boundingBox();
    if (size === null) throw new Error('The image picker did not render.');
    expect(size.width).toBe(size.height);
    await dialog.locator('.editor-attachments__list').evaluate((list) => { list.scrollLeft = list.scrollWidth; });
    await expect(add).toBeInViewport();
    const left = await add.evaluate((button) => button.getBoundingClientRect().left - (button.parentElement?.getBoundingClientRect().left ?? 0));
    expect(left).toBeLessThanOrEqual(5);
    await dialog.screenshot({ path: testInfo.outputPath(`request-image-tray-${mode}.png`) });
    await dialog.getByRole('button', { name: 'Remove tray-5.png' }).click();
    await expect(dialog.locator('.editor-attachments__tile')).toHaveCount(5);
    await dialog.getByRole('button', { name: 'Submit task' }).click();
    await expect(dialog).toHaveCount(0);
  }
});

for (const viewport of [{ width: 1280, height: 600 }, { width: 800, height: 500 }, { width: 390, height: 640 }]) {
  test(`request fields scroll without hiding actions at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.getByRole('button', { name: 'Add task' }).click();
    const dialog = page.getByRole('dialog', { name: 'New task' });
    await dialog.getByRole('textbox', { name: 'What should be done?' }).fill('Keep all actions accessible');
    await dialog.locator('input[type=file]').setInputFiles(
      Array.from({ length: 5 }, (_, index) => ({ name: `image-${index}.png`, mimeType: 'image/png', buffer: png })),
    );
    const submit = dialog.getByRole('button', { name: 'Submit task' });
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
    await submit.click();
    await expect(dialog).toHaveCount(0);
  });
}

test('request dialog attachments stay visible and operable on desktop, dark, and mobile', async ({
  page,
}, testInfo) => {
  const openRequest = async () => {
    await page.getByRole('button', { name: 'Add task' }).click();
    const dialog = page.getByRole('dialog', { name: 'New task' });
    await expect(dialog).toBeVisible();
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

  await page.evaluate(() =>
    localStorage.setItem('agboard.theme', JSON.stringify({ mode: 'dark', accent: 'blue' })),
  );
  await page.reload();
  await waitForSync(page);
  expect(await page.locator('html').getAttribute('data-mode')).toBe('dark');
  dialog = await openRequest();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await dialog.screenshot({ path: testInfo.outputPath('request-dark-empty.png') });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await waitForSync(page);
  dialog = await openRequest();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await dialog.screenshot({ path: testInfo.outputPath('request-mobile-empty.png') });
  await attach(dialog, 'mobile-notes.png');
  await expect(dialog.getByRole('button', { name: 'Remove mobile-notes.png' })).toBeInViewport();
  const mobileBox = await dialog.boundingBox();
  if (mobileBox === null) throw new Error('The mobile request dialog did not render.');
  expect(mobileBox.y + mobileBox.height).toBeLessThanOrEqual(844);
  await dialog.screenshot({ path: testInfo.outputPath('request-mobile-attached.png') });
  const submit = dialog.getByRole('button', { name: 'Submit task' });
  await submit.scrollIntoViewIfNeeded();
  await expect(submit).toBeInViewport();
});

test('simple requests accept pasted images in the text field and keep multiple square previews compact', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'Add task' }).click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  const textarea = dialog.getByRole('textbox', { name: 'What should be done?' });
  await textarea.fill('Investigate image request');
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
  await expect(dialog.getByRole('button', { name: 'Submit task' })).toBeInViewport();

  await dialog.getByRole('button', { name: 'Submit task' }).click();
  await expect(dialog).toHaveCount(0);
});

test('simple request save errors retain the API reason and keep text and images', async ({ page }) => {
  await page.goto('/');
  await waitForSync(page);
  await page.getByRole('button', { name: 'Add task' }).click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  await dialog.getByRole('textbox', { name: 'What should be done?' }).fill('Keep my request');
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'kept.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await page.route('**/tasks/multipart', (route) =>
    route.fulfill({ status: 400, json: { error: { reason: 'The selected epic is no longer available.' } } }),
  );
  await dialog.getByRole('button', { name: 'Submit task' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('The selected epic is no longer available.');
  await expect(dialog.getByRole('textbox', { name: 'What should be done?' })).toHaveValue('Keep my request');
  await expect(dialog.getByRole('button', { name: 'Remove kept.png' })).toBeVisible();
});
