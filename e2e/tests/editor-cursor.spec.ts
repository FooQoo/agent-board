import { expect, test } from '@playwright/test';
import { resetBoard, mainProject } from '../helpers/agboard';
import { resetPreferences, setPreferences } from '../helpers/preferences';
import { waitForSync, editorValue, openManualCreateDialog } from '../helpers/ui';

// The rich body editor of the add dialog: an empty editor shows its placeholder and takes typing, Enter starts a
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
      const dialog = await openManualCreateDialog(page);
      await expect(dialog).toBeVisible();
      const ai = dialog.getByRole('radio', { name: 'AI', exact: true });
      const user = dialog.getByRole('radio', { name: locale === 'ja' ? 'ユーザ' : 'User', exact: true });
      await expect(ai.locator('svg')).toBeVisible();
      await expect(user.locator('svg')).toBeVisible();
      await expect(ai).toHaveText('AI');
      await expect(user).toHaveText(locale === 'ja' ? 'ユーザ' : 'User');
      await expect(ai).toHaveCSS('width', '100px');
      await expect(user).toHaveCSS('width', '100px');
      await expect(ai).toHaveAttribute('aria-checked', 'true');
      await dialog.locator('.editor__segments').screenshot({ path: test.info().outputPath('assignee-icons.png') });

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
