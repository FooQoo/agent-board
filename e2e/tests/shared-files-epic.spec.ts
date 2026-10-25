import { expect, test, type Locator, type Page } from '@playwright/test';
import { agboardOk, mainProject, projectId, resetBoard, type TaskJson } from '../helpers/agboard';
import { resetPreferences, setPreferences } from '../helpers/preferences';
import { pasteMarkdown, waitForSync } from '../helpers/ui';

// The epic dialog on the real page: its name, colour, document, tasks, and images are saved together; a task opened from
// the list asks first when the epic has unsaved changes.

test.beforeEach(() => resetPreferences());
test.afterEach(() => resetPreferences());

const details = (page: Page) => page.getByRole('complementary', { name: 'Task details' });
const task = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });

function epicOf(id: string): { id: string; name: string; color: string; document: string } {
  return JSON.parse(agboardOk(mainProject, ['epic', 'show', id, '--json']).stdout).epic;
}

function taskOf(id: number): TaskJson & { epicId: string | null } {
  return JSON.parse(agboardOk(mainProject, ['show', String(id), '--json']).stdout).task;
}

/** The document body as a person pastes it into the body editor: free Markdown, no frontmatter. */
const DOCUMENT = [
  '## Goal',
  '',
  'Share files between the tasks of one epic.',
  '',
  '## Scope',
  '',
  'The shared folder only.',
  '',
  '## Approach',
  '',
  'Write the document first, then the tasks.',
  '',
].join('\n');

async function openEpic(page: Page, epicId: string): Promise<Locator> {
  await page.locator(`[data-epic-label="${epicId}"]`).first().click();
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('textbox', { name: 'Title' }) });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.beforeEach(() => {
  resetBoard(mainProject);
  agboardOk(mainProject, ['epic', 'add', 'FILE-SHARE', '--name', 'File share', '--color', '#7C3AED', '--actor', 'human']);
  agboardOk(mainProject, ['edit', '14', '--epic', 'FILE-SHARE']);
});

test('the epic dialog saves its name, colour, and document together, and its contents are read back by the CLI', async ({ page }) => {
  await page.goto(`/?project=${projectId(mainProject)}`);
  await waitForSync(page);
  const dialog = await openEpic(page, 'FILE-SHARE');

  // Name, colour, and document; nothing is stored until Save.
  await dialog.getByRole('textbox', { name: 'Title' }).fill('File sharing');
  await dialog.getByRole('button', { name: 'Choose a label color' }).click();
  await page.getByLabel('HEX', { exact: true }).fill('#2563eb');
  await page.getByLabel('HEX', { exact: true }).press('Escape');
  await pasteMarkdown(dialog.getByRole('textbox', { name: 'Epic details (Markdown)' }), DOCUMENT);
  expect(epicOf('FILE-SHARE').name).toBe('File share');
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  // The CLI reads the same epic: the name, the colour, and the document.
  const stored = epicOf('FILE-SHARE');
  expect(stored).toMatchObject({ name: 'File sharing', color: '#2563EB' });
  expect(stored.document).toContain('## Approach');
  expect(stored.document).not.toContain('acceptance:');
  expect(taskOf(14).epicId).toBe('FILE-SHARE');

  // The label and the card frame show the new name and colour.
  await expect(page.locator('[data-epic-label="FILE-SHARE"]').first()).toHaveCSS('background-color', 'rgb(37, 99, 235)');
  await expect(task(page, 14).locator('[data-epic-label="FILE-SHARE"]')).toHaveCount(1);
});

test('a task opened from the progress table asks first when the epic has unsaved changes; going back keeps the edit, and moving discards it', async ({ page }) => {
  await page.goto(`/?project=${projectId(mainProject)}`);
  await waitForSync(page);
  const dialog = await openEpic(page, 'FILE-SHARE');
  await dialog.getByRole('textbox', { name: 'Title' }).fill('Unsaved name');

  // The task name in the list asks before the dialog closes.
  await dialog.locator('.epic-progress__name', { hasText: 'Prepare the Windows build' }).click();
  const ask = page.getByRole('dialog', { name: /Discard changes\?/ });
  await expect(ask.getByText('You have unsaved changes. If you close now, what you entered will be lost.')).toBeVisible();
  // Back returns to the epic with the text kept.
  await ask.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(ask).toHaveCount(0);
  await expect(dialog.getByRole('textbox', { name: 'Title' })).toHaveValue('Unsaved name');

  // Moving discards the epic's change and shows the task.
  await dialog.locator('.epic-progress__name', { hasText: 'Prepare the Windows build' }).click();
  await page.getByRole('dialog', { name: /Discard changes\?/ }).getByRole('button', { name: 'Discard and move', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(details(page).getByRole('heading', { level: 2 })).toHaveText('Prepare the Windows build');
  expect(epicOf('FILE-SHARE').name).toBe('File share');
});

for (const locale of ['en', 'ja'] as const) {
  for (const mode of ['light', 'dark'] as const) {
    test(`epic palette matches the design in ${locale}, ${mode}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: locale === 'ja' ? 960 : 1280, height: 900 });
      await setPreferences({ locale, theme: { mode, accent: 'blue' } });
      await page.goto(`/?project=${projectId(mainProject)}`);
      await waitForSync(page);
      const epicLabel = page.locator('[data-epic-label="FILE-SHARE"]').first();
      await expect(epicLabel).toHaveCSS('background-color', 'rgb(124, 58, 237)');
      await epicLabel.click();
      const dialog = page.locator('.editor-dialog');
      const pick = locale === 'en' ? 'Choose a label color' : 'ラベル色を選ぶ';
      await dialog.getByRole('button', { name: pick }).click();
      const palette = page.locator('.epic-color');
      await expect(palette).toBeVisible();
      await expect(palette.getByLabel('HEX', { exact: true })).toHaveValue('#7C3AED');
      await expect(palette).toHaveCSS('width', '260px');
      await expect(palette.locator('.epic-color__map')).toHaveCSS('height', '136px');
      await palette.screenshot({ path: testInfo.outputPath('palette.png') });
      const box = await palette.locator('.epic-color__map').boundingBox();
      if (!box) throw new Error('Color map has no bounds');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.2);
      await page.mouse.up();
      await expect(palette.getByLabel('HEX', { exact: true })).not.toHaveValue('#7C3AED');
      await palette.getByLabel('HEX', { exact: true }).fill('#00ff00');
      await expect(dialog.locator('.editor__epic-chip')).toHaveCSS('background-color', 'rgb(0, 255, 0)');
      expect(epicOf('FILE-SHARE').color).toBe('#7C3AED');
      await palette.getByLabel('HEX', { exact: true }).press('Escape');
      await expect(dialog).toBeVisible();

      expect(taskOf(14).epicId).toBe('FILE-SHARE');
      await dialog.getByRole('button', { name: locale === 'en' ? 'Save' : '保存', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect(epicOf('FILE-SHARE').color).toBe('#00FF00');
    });
  }
}

for (const [mode, width, height] of [['light', 1280, 800], ['dark', 960, 640]] as const) {
  test(`epic image list scrolls independently with fixed controls in ${mode}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await setPreferences({ theme: { mode, accent: 'blue' } });
    await page.goto(`/?project=${projectId(mainProject)}`);
    await waitForSync(page);
    const dialog = await openEpic(page, 'FILE-SHARE');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
    await dialog.getByRole('button', { name: /^Attachments/ }).click();
    await dialog.locator('input[type="file"]').setInputFiles(Array.from({ length: 6 }, (_, i) => ({ name: `image-${i}.png`, mimeType: 'image/png', buffer: png })));
    const images = dialog.locator('.editor-attachments__list');
    const outline = dialog.getByRole('navigation', { name: 'Outline' });
    // The epic dialog shows the section's own toggle as the fixed heading (its inner header is hidden).
    const imageHead = dialog.getByRole('button', { name: /^Attachments/ });
    const imageAdd = dialog.getByRole('button', { name: 'Add image attachment', exact: true });
    const drop = dialog.locator('.editor-attachments__drop');
    await expect.poll(() => dialog.evaluate((node) => node.getAnimations().every((animation) => animation.playState !== 'running'))).toBe(true);
    const positions = await Promise.all([outline, imageHead, imageAdd, drop].map((node) => node.boundingBox()));
    expect(await images.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    await images.hover();
    await page.mouse.wheel(0, 800);
    await expect.poll(() => images.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    const after = await Promise.all([outline, imageHead, imageAdd, drop].map((node) => node.boundingBox()));
    expect(after).toEqual(positions);
    expect(await dialog.locator('.editor__side').evaluate((node) => node.scrollTop)).toBe(0);
    expect(await dialog.locator('.editor-attachments__dropzone').evaluate((node) => node.scrollTop)).toBe(0);
    await dialog.screenshot({ path: testInfo.outputPath('independent-scroll.png') });
  });
}
