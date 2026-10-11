import { expect, test } from '@playwright/test';
import { resetBoard, mainProject } from '../helpers/agboard';
import { waitForSync, editorValue } from '../helpers/ui';

// The rich body editor of the add dialog: an empty editor shows its placeholder and takes typing, Enter starts a
// new paragraph, and Home and the arrows move the caret inside the text. The Markdown it writes has a blank line
// between blocks.

for (const locale of ['en', 'ja'] as const) {
  for (const mode of ['light', 'dark'] as const) {
    test(`${locale}/${mode}: an empty editor shows its placeholder and takes the caret`, async ({ page }) => {
      await page.addInitScript(
        ({ locale, mode }) => {
          localStorage.setItem('agboard.locale', locale);
          localStorage.setItem('agboard.theme', JSON.stringify({ mode, accent: 'blue' }));
        },
        { locale, mode },
      );
      resetBoard(mainProject);
      await page.goto('/');
      await waitForSync(page);
      await page.getByRole('button', { name: locale === 'ja' ? 'カード追加' : 'Add card', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: locale === 'ja' ? 'カードを追加' : 'Add card' });
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
      await page.keyboard.press('Home');
      await page.keyboard.type('Start ');
      expect(await editorValue(content)).toBe('Start First\n\nSecond');
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
      await page.keyboard.press('Backspace');
      await expect(content.locator('.crepe-placeholder')).toHaveCount(1);
    });
  }
}
