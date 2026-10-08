import { expect, test } from '@playwright/test';
import { resetBoard, mainProject } from '../helpers/agboard';
import { waitForSync, editorValue } from '../helpers/ui';

for (const locale of ['en', 'ja'] as const) {
for (const mode of ['light', 'dark'] as const) {
test(`${locale}/${mode}: an empty editor keeps a one-line caret with a multiline placeholder`, async ({ page }) => {
  await page.addInitScript(({locale, mode}) => { localStorage.setItem('skan.locale', locale); localStorage.setItem('agboard.theme', JSON.stringify({mode, accent: 'blue'})); }, {locale, mode});
  resetBoard(mainProject);
  await page.goto('/'); await waitForSync(page);
  await page.getByRole('button', { name: locale === 'ja' ? 'カード追加' : 'Add card', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: locale === 'ja' ? 'カードを追加' : 'Add card' });
  await expect.poll(async () => Math.round((await dialog.boundingBox())!.width)).toBe(960);
  const content = dialog.locator('.cm-content');
  await content.click({ position: { x: 18, y: 20 } });
  const heights = await content.evaluate((element) => {
    const line = element.querySelector('.cm-line')!;
    const placeholder = element.querySelector('.cm-placeholder')!;
    return { line: line.getBoundingClientRect().height, placeholder: placeholder.getBoundingClientRect().height };
  });
  await page.screenshot({ caret: 'initial', path: test.info().outputPath('empty-editor-cursor.png') });
  expect(heights.placeholder).toBeGreaterThan(42);
  expect(heights.line).toBeLessThanOrEqual(22);
  await page.keyboard.type('First');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second');
  expect(await editorValue(content)).toBe('First\nSecond');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Home');
  await page.keyboard.type('Start ');
  expect(await editorValue(content)).toBe('Start First\nSecond');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.keyboard.press('Backspace');
  await expect(dialog.locator('.cm-placeholder')).toBeVisible();
  expect(await dialog.locator('.cm-line').evaluate((line) => line.getBoundingClientRect().height)).toBeLessThanOrEqual(22);
});

}
}
