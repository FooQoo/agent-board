import { expect, test } from '@playwright/test';
import path from 'node:path';
import { agboardOk, mainProject, nextTaskId, projectId, replaceFileAtomically, resetBoard, workspace } from '../helpers/agboard';
import { openManualCreateDialog, waitForSync } from '../helpers/ui';

const conditions = Array.from({ length: 40 }, (_, i) => `- [ ] Condition ${i + 1}`).join('\n');
const body = `# 進行表と自動完了によるAIの操作削減\n\n## 目的・背景\n\nAIがプロジェクト全体の進行表から作業を選び、必要なエピック計画と作業記録だけを読んで進める。完了更新とプロジェクト指定の操作を減らす。\n\n## スコープ\n\n進行表、プロジェクトとフォルダの登録、エピックの進行順、Hook、自動Doneを扱う。\n\n### プロジェクトの識別\n\nフォルダの登録では \`agboard project bind NAME\` を使い、最も近い祖先の登録を参照する。\n\n${'More body text.\n\n'.repeat(60)}\n\n## Reference conditions\n\n${conditions}`;

for (const mode of ['light', 'dark'] as const) {
  for (const locale of ['en', 'ja'] as const) {
    test(`epic panels stay inside the dialog with many tasks and conditions (${locale}/${mode})`, async ({ page }, testInfo) => {
      resetBoard(mainProject);
      agboardOk(mainProject, ['epic', 'add', 'PANELS', '--name', 'Panel layout', '--color', '#7C3AED', '--actor', 'human']);
      const folder = workspace(mainProject).folder;
      replaceFileAtomically(path.join(folder, 'epics', 'PANELS', 'EPIC.md'), body);
      for (let i = 1; i <= 16; i++) {
        agboardOk(mainProject, ['add', `Work item ${i}`, '--assignee', 'human', '--actor', 'human', '--epic', 'PANELS', '--desc', '---\nacceptance:\n  - id: AC-1\n    text: First check\n    done: true\n  - id: AC-2\n    text: Second check\n    done: false\n---\n\nTask body.']);
      }
      await page.setViewportSize({ width: locale === 'ja' ? 1600 : 1024, height: locale === 'ja' ? 1100 : 900 });
      await page.addInitScript(({ mode, locale }) => {
        localStorage.setItem('agboard.locale', locale);
        localStorage.setItem('agboard.theme', JSON.stringify({ mode, accent: 'blue' }));
      }, { mode, locale });
      await page.goto(`/?project=${projectId(mainProject)}`);
      await waitForSync(page);
      await page.locator('[data-epic-label="PANELS"]').first().click();
      const dialog = page.locator('.editor-dialog');
      const list = dialog.locator('.epic-progress__list');
      await expect(list.locator('.epic-progress__row')).toHaveCount(16);
      await expect.poll(() => list.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(0);
      const row = list.locator('.epic-progress__row').first();
      await expect(row).toHaveCSS('border-radius', '10px');
      await expect(row.locator('.card__title')).toHaveCSS('font-size', '14px');
      await expect(row.locator('.card__title')).toHaveCSS('font-weight', '400');
      await expect(row.locator('.card__foot .acceptance-chip')).toHaveText('1/2');
      await expect.poll(() => row.locator('.card__foot').evaluate((foot) => {
        const updated = foot.querySelector('.card__updated')!;
        return updated.getBoundingClientRect().x - foot.getBoundingClientRect().x;
      })).toBeLessThan(1);
      const footer = await dialog.locator('.editor__footer').boundingBox();
      const listBox = await list.boundingBox();
      expect(listBox!.y + listBox!.height).toBeLessThan(footer!.y);
      await list.hover();
      await page.mouse.wheel(0, 3000);
      await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      await expect(list.getByText('Work item 16', { exact: true })).toBeInViewport();
      const imageHead = dialog.getByRole('button', { name: locale === 'ja' ? /^添付画像/ : /^Attachments/ });
      await expect(imageHead.locator('.collapsible__icon')).toBeVisible();
      await expect(imageHead).toBeInViewport();
      await expect(dialog.locator('.conditions-dock')).toHaveCount(0);
      await expect(dialog.locator('.editor__document')).toBeInViewport();
      await expect(dialog.locator('.editor__dock')).toHaveCount(0);
      const documentBox = await dialog.locator('.editor__document').boundingBox();
      const currentFooter = await dialog.locator('.editor__footer').boundingBox();
      expect(documentBox!.y + documentBox!.height).toBeLessThanOrEqual(currentFooter!.y);
      await page.screenshot({ path: testInfo.outputPath('epic-panels.png') });
    });
  }
}

test('creation and task editing use the same single conditions panel and compact body start', async ({ page }, testInfo) => {
  resetBoard(mainProject);
  const id = nextTaskId(mainProject);
  agboardOk(mainProject, ['add', 'Task layout', '--desc', body, '--assignee', 'human', '--actor', 'human']);
  await page.goto(`/?project=${projectId(mainProject)}`);
  await waitForSync(page);
  await page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) }).click();
  await page.getByRole('button', { name: 'Make draft', exact: true }).click();
  await page.getByRole('button', { name: 'Edit task', exact: true }).click();
  const dialog = page.locator('.editor-dialog');
  await dialog.locator('.conditions-dock__head').click();
  await expect(dialog.locator('.acceptance-edit__head')).toHaveCount(0);
  await expect(dialog.locator('.conditions-dock__title')).toHaveCSS('font-size', '14px');
  await page.screenshot({ path: testInfo.outputPath('card-edit.png') });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await openManualCreateDialog(page);
  await dialog.locator('.conditions-dock__head').click();
  await dialog.getByRole('button', { name: 'Add condition', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Condition AC-1', exact: true }).fill('First condition');
  await expect(dialog.getByRole('textbox', { name: 'Condition AC-1', exact: true })).not.toHaveAttribute('aria-invalid', 'true');
  const editor = dialog.getByRole('textbox', { name: 'Description (Markdown)' });
  await editor.fill('First body line.');
  await expect(dialog.locator('.editor__counter')).toHaveText('17 / 50,000');
  const label = await dialog.locator('.editor__label-row').boundingBox();
  const text = await editor.locator('p').first().boundingBox();
  expect(text!.y - label!.y - label!.height).toBeLessThanOrEqual(16);
  await expect(editor.locator('p').first()).toHaveCSS('font-size', '14px');
  await page.screenshot({ path: testInfo.outputPath('card-create.png') });
});
