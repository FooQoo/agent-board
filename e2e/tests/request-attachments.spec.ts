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
  await expect(dialog.getByText('· 0', { exact: true })).toBeVisible();

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
