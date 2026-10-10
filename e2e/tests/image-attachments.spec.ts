import { expect, test, type Locator } from '@playwright/test';
import { agboardOk, mainProject, nextCardId, resetBoard, taskBody } from '../helpers/agboard';
import { pasteMarkdown, waitForSync } from '../helpers/ui';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==',
  'base64',
);

const body = (dialog: Locator) => dialog.getByRole('textbox', { name: 'Description (Markdown)' });

/** The reference of an inserted picture, as the editor writes it: `![capture.png](attachment:<id>)`. */
const reference = /!\[capture\.png\]\(attachment:[0-9a-f]{32}\)/;

test.beforeEach(() => resetBoard(mainProject));

test('side attachments render, persist, retry safely and become No image after deletion', async ({ page }) => {
  const id = nextCardId(mainProject);
  await page.goto('/');
  await waitForSync(page);
  await page.getByRole('button', { name: 'Add card', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add card' });
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill('Image round trip');
  // The body starts with the required headings; the picture is inserted into it from the side pane.
  await pasteMarkdown(body(dialog), taskBody('Pictures follow.'));
  // The caret goes to the end of the text, so the picture is inserted there and not over the selection.
  await body(dialog).getByText('Pictures follow.').click();
  await page.keyboard.press('End');
  // The attachments pane is open beside the body from the start, with its empty hint.
  await expect(dialog.getByText('Add images to this card')).toBeVisible();
  await dialog.locator('input[type=file]').setInputFiles({ name: 'capture.png', mimeType: 'image/png', buffer: png });
  await expect
    .poll(() => dialog.locator('.editor-attachments__preview img').evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(1);
  await dialog.getByRole('button', { name: 'Preview capture.png' }).click();
  await expect(page.getByRole('dialog', { name: 'capture.png', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'capture.png', exact: true })).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Insert in description' }).click();
  // The picture is inserted into the body as an image, and renders there.
  await expect(body(dialog).locator('img').first()).toBeVisible();
  await expect
    .poll(() => body(dialog).locator('img').first().evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(1);
  await page.screenshot({ path: test.info().outputPath('01-right-attachments.png') });

  const requests: string[] = [];
  let loseResponse = true;
  await page.route('**/cards/multipart', async (route) => {
    requests.push((route.request().postDataBuffer()?.toString() ?? '').match(/"requestId":"([^"]+)"/)?.[1] ?? 'missing');
    if (!loseResponse) return route.continue();
    loseResponse = false;
    await route.fetch();
    return route.abort('failed');
  });
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(requests).toHaveLength(2);
  expect(requests[0]).not.toBe('missing');
  expect(requests[1]).toBe(requests[0]);
  const show = () => JSON.parse(agboardOk(mainProject, ['show', String(id), '--json']).stdout).card;
  // The saved body holds the reference, not a link to the page or to a blob.
  expect(show().description).toMatch(reference);
  expect(show().description).not.toMatch(/blob:|localhost|127\.0\.0\.1/);
  expect(show().attachments).toHaveLength(1);
  expect(nextCardId(mainProject)).toBe(id + 1);

  await page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) }).click();
  const detail = page.getByRole('complementary', { name: 'Card details' });
  await expect
    .poll(() => detail.locator('.md__image-picture').evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(1);
  await page.reload();
  await waitForSync(page);
  await page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) }).click();
  await expect
    .poll(() => detail.locator('.md__image-picture').evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(1);
  await page.screenshot({ path: test.info().outputPath('02-saved-image.png') });

  // Delete the picture in the editor: the reference stays in the body and shows as No image.
  await detail.getByRole('button', { name: 'Make draft' }).click();
  await detail.getByRole('button', { name: 'Edit card' }).click();
  const edit = page.getByRole('dialog', { name: new RegExp(`^#${id} Image round trip`) });
  await edit.getByRole('button', { name: 'Remove capture.png' }).click();
  // Finalize with the Draft box, then save.
  await edit.getByRole('checkbox', { name: 'Draft' }).click();
  await edit.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(edit).toHaveCount(0);
  expect(show().attachments).toHaveLength(0);
  expect(show().isDraft).toBe(false);
  await expect(detail.getByText('No image', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('03-deleted-no-image.png') });
});

test('clipboard images open the side pane and cancellation discards them', async ({ page }) => {
  const id = nextCardId(mainProject);
  await page.goto('/');
  await waitForSync(page);
  await page.getByRole('button', { name: 'Add card', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add card' });
  await body(dialog).evaluate((element, base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'clipboard.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, png.toString('base64'));
  await expect
    .poll(() => dialog.locator('.editor-attachments__preview img').evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(1);
  await dialog.getByRole('button', { name: 'Insert in description' }).click();
  await expect(body(dialog).locator('img').first()).toBeAttached();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(nextCardId(mainProject)).toBe(id);
});

test('drop works at narrow widths without shrinking the body and CLI can read saved image bytes', async ({ page }, info) => {
  const id = nextCardId(mainProject);
  await page.setViewportSize({ width: 960, height: 900 });
  await page.goto('/');
  await waitForSync(page);
  await page.getByRole('button', { name: 'Add card', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add card' });
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill('Dropped image');
  await pasteMarkdown(body(dialog), taskBody('Dropped below.'));
  const widthBefore = (await body(dialog).boundingBox())!.width;
  await body(dialog).evaluate((element, base64) => {
    const data = new DataTransfer();
    data.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], 'drop.png', { type: 'image/png' }));
    element.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
  }, png.toString('base64'));
  await expect(dialog.locator('.editor-attachments__preview img')).toHaveCount(1);
  expect((await body(dialog).boundingBox())!.width).toBe(widthBefore);
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const saved = JSON.parse(agboardOk(mainProject, ['show', String(id), '--json']).stdout).card;
  const output = info.outputPath('downloaded.png');
  agboardOk(mainProject, ['attachment', 'get', String(id), saved.attachments[0].id, '--output', output]);
  const { readFileSync, writeFileSync } = await import('node:fs');
  expect(readFileSync(output)).toEqual(png);
  // The reverse direction: CLI attachments appear in the detail list even without a body reference.
  const file = info.outputPath('cli.png');
  writeFileSync(file, png);
  agboardOk(mainProject, ['attachment', 'add', String(id), '--file', file, '--actor', 'ai']);
  await page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) }).click();
  const detail = page.getByRole('complementary', { name: 'Card details' });
  await expect(detail.locator('.detail-attachments__tile')).toHaveCount(2);
  await expect
    .poll(() =>
      detail
        .locator('.detail-attachments__tile img')
        .evaluateAll((images) => images.every((i) => (i as HTMLImageElement).naturalWidth === 1)),
    )
    .toBe(true);
});
