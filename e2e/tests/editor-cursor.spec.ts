import { expect, test } from '../helpers/fixtures';
import { agboardOk, resetBoard, mainProject, nextTaskId } from '../helpers/agboard';
import { resetPreferences, setPreferences } from '../helpers/preferences';
import { putDraft } from '../helpers/drafts';
import { waitForSync, editorValue } from '../helpers/ui';

// The rich body editor of a task's full-screen editor: an empty editor shows its placeholder and takes typing, Enter starts a
// new paragraph, and Home and the arrows move the caret inside the text. The Markdown it writes has a blank line
// between blocks.

test.beforeEach(() => resetPreferences());
test.afterEach(() => resetPreferences());

for (const locale of ['en', 'ja'] as const) {
  for (const mode of ['light', 'dark'] as const) {
    test(`${locale}/${mode}: an empty editor shows its placeholder and takes the caret`, async ({ page }) => {
      resetBoard(mainProject);
      await setPreferences({ locale, theme: { mode, accent: 'blue' } });
      await page.goto('/');
      await waitForSync(page);
      // An empty draft, created the way the CLI does, opened in its full-screen editor.
      const id = nextTaskId(mainProject);
      agboardOk(mainProject, ['add', 'Cursor check', '--assignee', 'human', '--actor', 'human']);
      await page.reload();
      await waitForSync(page);
      await page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) }).click();
      await putDraft(id);
      await page
        .getByRole('complementary', { name: /^(Task details|タスクの詳細)$/ })
        .getByRole('button', { name: /^(Open full screen \(task\)|全画面で開く（タスク）)$/ })
        .click();
      const dialog = page.getByRole('dialog', { name: new RegExp(`^#${id} `) });
      await expect(dialog).toBeVisible();

      const content = dialog.getByRole('textbox', { name: locale === 'ja' ? '説明(Markdown)' : 'Description (Markdown)' });
      await content.click({ position: { x: 18, y: 20 } });
      // The placeholder is the editor's own paragraph, shown while the body is empty.
      await expect(content.locator('.crepe-placeholder')).toHaveCount(1);
      await page.screenshot({ caret: 'initial', path: test.info().outputPath('empty-editor-cursor.png') });
      await page.keyboard.type('First');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Second');
      expect(await editorValue(content)).toBe('First\n\nSecond');
      await expect(content.locator('.crepe-placeholder')).toHaveCount(0);
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home');
      await page.keyboard.type('Start ');
      expect(await editorValue(content)).toBe('Start First\n\nSecond');
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
      await page.keyboard.press('Backspace');
      await expect(content.locator('.crepe-placeholder')).toHaveCount(1);
    });
  }
}
