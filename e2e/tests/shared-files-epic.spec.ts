import { expect, test, type Locator, type Page } from '@playwright/test';
import { agboardOk, mainProject, projectId, resetBoard, type CardJson } from '../helpers/agboard';
import { pasteMarkdown, waitForSync } from '../helpers/ui';

// The epic dialog on the real page: its name, colour, plan, tasks, and images are saved together; a task opened from
// the list asks first when the epic has unsaved changes.

const details = (page: Page) => page.getByRole('complementary', { name: 'Card details' });
const card = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });

function epicOf(id: string): { id: string; name: string; color: string; plan: string } {
  return JSON.parse(agboardOk(mainProject, ['epic', 'show', id, '--json']).stdout).epic;
}

function cardOf(id: number): CardJson & { epicId: string | null } {
  return JSON.parse(agboardOk(mainProject, ['show', String(id), '--json']).stdout).card;
}

/** The plan with the four headings the plan format requires, and one completion condition. */
const PLAN = [
  '## Goal',
  '',
  'Share files between the tasks of one epic.',
  '',
  '## Scope',
  '',
  'The shared folder only.',
  '',
  '## Completion conditions',
  '',
  '- [ ] AC-1. The plan is saved with the tasks.',
  '  - Result: Not verified',
  '  - Evidence: Not recorded',
  '  - Coordinator check: Not checked',
  '',
  '## Approach',
  '',
  'Write the plan first, then the tasks.',
  '',
].join('\n');

async function openEpic(page: Page, epicId: string): Promise<Locator> {
  await page.locator(`[data-epic-label="${epicId}"]`).first().click();
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('textbox', { name: 'Formal name' }) });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.beforeEach(() => {
  resetBoard(mainProject);
  agboardOk(mainProject, ['epic', 'add', 'FILE-SHARE', '--name', 'File share', '--color', '#7C3AED', '--actor', 'human']);
  agboardOk(mainProject, ['edit', '14', '--epic', 'FILE-SHARE']);
});

test('the epic dialog saves its name, colour, plan, and tasks together, and its contents are read back by the CLI', async ({ page }) => {
  await page.goto(`/?project=${projectId(mainProject)}`);
  await waitForSync(page);
  const dialog = await openEpic(page, 'FILE-SHARE');

  // Name, colour, plan, and one more task in the epic; nothing is stored until Save.
  await dialog.getByRole('textbox', { name: 'Formal name' }).fill('File sharing');
  await dialog.getByRole('button', { name: 'Choose a label color' }).click();
  await page.getByLabel('HEX', { exact: true }).fill('#2563eb');
  await page.getByLabel('HEX', { exact: true }).press('Escape');
  await pasteMarkdown(dialog.getByRole('textbox', { name: 'Plan (Markdown)' }), PLAN);
  await dialog.getByRole('checkbox', { name: 'Include in this epic: Refine the empty board' }).check();
  expect(epicOf('FILE-SHARE').name).toBe('File share');
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  // The CLI reads the same epic: the name, the colour, the plan, and both tasks.
  const stored = epicOf('FILE-SHARE');
  expect(stored).toMatchObject({ name: 'File sharing', color: '#2563EB' });
  expect(stored.plan).toContain('## Approach');
  expect(stored.plan).toContain('- [ ] AC-1. The plan is saved with the tasks.');
  expect(cardOf(16).epicId).toBe('FILE-SHARE');
  expect(cardOf(14).epicId).toBe('FILE-SHARE');

  // The label and the card frame show the new name and colour.
  await expect(page.locator('[data-epic-label="FILE-SHARE"]').first()).toHaveCSS('background-color', 'rgb(37, 99, 235)');
  await expect(card(page, 16).locator('[data-epic-label="FILE-SHARE"]')).toHaveCount(1);
});

test('a task opened from the epic asks first when the epic has unsaved changes; going back keeps the edit, and moving discards it', async ({ page }) => {
  await page.goto(`/?project=${projectId(mainProject)}`);
  await waitForSync(page);
  const dialog = await openEpic(page, 'FILE-SHARE');
  await dialog.getByRole('textbox', { name: 'Formal name' }).fill('Unsaved name');

  // The task name in the list asks before the dialog closes.
  await dialog.locator('.epic-tasks__name', { hasText: 'Return the card list as JSON' }).click();
  const ask = page.getByRole('dialog', { name: /Discard changes\?/ });
  await expect(ask.getByText('You have unsaved changes. If you close now, what you entered will be lost.')).toBeVisible();
  // Back returns to the epic with the text kept.
  await ask.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(ask).toHaveCount(0);
  await expect(dialog.getByRole('textbox', { name: 'Formal name' })).toHaveValue('Unsaved name');

  // Moving discards the epic's change and shows the task.
  await dialog.locator('.epic-tasks__name', { hasText: 'Return the card list as JSON' }).click();
  await page.getByRole('dialog', { name: /Discard changes\?/ }).getByRole('button', { name: 'Discard and move', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(details(page).getByRole('heading', { level: 2 })).toHaveText('Return the card list as JSON');
  expect(epicOf('FILE-SHARE').name).toBe('File share');
});

test('the plan without its required headings is refused with the reason, and the next valid save goes through', async ({ page }) => {
  await page.goto(`/?project=${projectId(mainProject)}`);
  await waitForSync(page);
  const dialog = await openEpic(page, 'FILE-SHARE');
  // The whole plan is replaced: the template is selected and removed before the text is pasted.
  const plan = dialog.getByRole('textbox', { name: 'Plan (Markdown)' });
  await plan.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await pasteMarkdown(plan, '## Goal\n\nOnly the purpose.\n');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  // The screen names the step that failed and keeps what was typed.
  await expect(dialog.getByRole('alert')).toContainText('Could not save the plan');
  // Nothing changed on disk; the typed plan is kept on the screen.
  expect(epicOf('FILE-SHARE').plan).toContain('## Approach');
  await expect(plan).toContainText('Only the purpose.');

  // Fixing the plan and saving again works.
  await plan.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await pasteMarkdown(plan, PLAN);
  await dialog.getByRole('textbox', { name: 'Formal name' }).fill('File share, planned');
  await dialog.getByRole('button', { name: /^(Save|Retry and save)$/ }).click();
  await expect(dialog).toHaveCount(0);
  expect(epicOf('FILE-SHARE')).toMatchObject({ name: 'File share, planned' });
});

for (const locale of ['en', 'ja'] as const) {
  for (const mode of ['light', 'dark'] as const) {
    test(`epic palette and task filter match the design in ${locale}, ${mode}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: locale === 'ja' ? 960 : 1280, height: 900 });
      await page.addInitScript(({ locale, mode }) => {
        localStorage.setItem('agboard.locale', locale);
        localStorage.setItem('agboard.theme', JSON.stringify({ mode, accent: 'blue' }));
      }, { locale, mode });
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

      const initialCount = await dialog.locator('.epic-tasks__row').count();
      await dialog.getByRole('button', { name: locale === 'en' ? 'Filter tasks' : 'タスクを絞り込む' }).click();
      const filter = page.locator('.epic-filter');
      await expect(filter).toHaveCSS('width', '248px');
      await filter.screenshot({ path: testInfo.outputPath('filter.png') });
      await filter.getByRole('checkbox', { name: locale === 'en' ? 'Other' : 'その他', exact: true }).uncheck();
      await filter.getByRole('button', { name: locale === 'en' ? 'Cancel' : 'キャンセル', exact: true }).click();
      await expect(dialog.locator('.epic-tasks__row')).toHaveCount(initialCount);
      await dialog.getByRole('button', { name: locale === 'en' ? 'Filter tasks' : 'タスクを絞り込む' }).click();
      await expect(filter.getByRole('checkbox', { name: locale === 'en' ? 'Other' : 'その他', exact: true })).toBeChecked();
      await filter.getByRole('checkbox', { name: locale === 'en' ? 'Other' : 'その他', exact: true }).uncheck();
      await filter.getByRole('button', { name: locale === 'en' ? 'Apply' : '適用', exact: true }).click();
      await expect(dialog.locator('.epic-tasks__row')).toHaveCount(1);
      expect(cardOf(14).epicId).toBe('FILE-SHARE');
      await dialog.getByRole('button', { name: locale === 'en' ? 'Save' : '保存', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect(epicOf('FILE-SHARE').color).toBe('#00FF00');
    });
  }
}

for (const [mode, width, height] of [['light', 1280, 800], ['dark', 960, 640]] as const) {
  test(`epic task and image lists scroll independently with fixed controls in ${mode}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript((mode) => localStorage.setItem('agboard.theme', JSON.stringify({ mode, accent: 'blue' })), mode);
    await page.goto(`/?project=${projectId(mainProject)}`);
    await waitForSync(page);
    const dialog = await openEpic(page, 'FILE-SHARE');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
    await dialog.locator('input[type="file"]').setInputFiles(Array.from({ length: 6 }, (_, i) => ({ name: `image-${i}.png`, mimeType: 'image/png', buffer: png })));
    const tasks = dialog.locator('.epic-tasks__list');
    const images = dialog.locator('.editor-attachments__list');
    const outline = dialog.getByRole('navigation', { name: 'Outline' });
    const taskHead = dialog.locator('.epic-tasks__head');
    const imageHead = dialog.locator('.editor-attachments__header');
    const imageAdd = dialog.getByRole('button', { name: 'Add image attachment', exact: true });
    const drop = dialog.locator('.editor-attachments__drop');
    await expect.poll(() => dialog.evaluate((node) => node.getAnimations().every((animation) => animation.playState !== 'running'))).toBe(true);
    const positions = await Promise.all([outline, taskHead, imageHead, imageAdd, drop].map((node) => node.boundingBox()));
    for (const list of [tasks, images]) {
      expect(await list.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
      await list.hover();
      await page.mouse.wheel(0, 800);
      await expect.poll(() => list.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    }
    const after = await Promise.all([outline, taskHead, imageHead, imageAdd, drop].map((node) => node.boundingBox()));
    expect(after).toEqual(positions);
    expect(await dialog.locator('.editor__side').evaluate((node) => node.scrollTop)).toBe(0);
    expect(await dialog.locator('.editor-attachments__dropzone').evaluate((node) => node.scrollTop)).toBe(0);
    await dialog.screenshot({ path: testInfo.outputPath('independent-scroll.png') });
  });
}
