import { expect, test } from '@playwright/test';
import { agboardOk, mainProject, nextTaskId, projectId, resetBoard } from '../helpers/agboard';
import { waitForSync } from '../helpers/ui';

test.afterEach(async ({ page }) => {
  resetBoard(mainProject);
  await page.reload();
  await waitForSync(page);
  await expect(page.locator('.card__id')).toHaveCount(8);
});

for (const { locale, theme, height } of [
  { locale: 'ja', theme: 'dark', height: 600 },
  { locale: 'en', theme: 'light', height: 900 },
]) {
  test(`a crowded lane keeps a long pending request readable and answerable (${locale}, ${height})`, async ({ page }, testInfo) => {
    resetBoard(mainProject);
    for (let i = 0; i < 12; i++) {
      agboardOk(mainProject, ['add', `Other work ${i}`, '--assignee', 'ai', '--actor', 'ai']);
    }
    const id = nextTaskId(mainProject);
    const question = '共有ホームとsetupの全体計画と詳細計画を承認しますか？ ~/.agent-boardを既定の保存先にし、agboard setupでCodex・Claude Codeの共有フォルダ設定へ追加します。既存設定を保持し、旧データの移行は行いません。';
    agboardOk(mainProject, ['add', '共有ホームとsetupの計画をレビューする', '--assignee', 'ai', '--actor', 'ai']);
    agboardOk(mainProject, ['state', String(id), 'pending', '--actor', 'ai', '--request-json', JSON.stringify({
      question,
      choices: [{ id: 'approve', label: 'この計画を承認する' }, { id: 'revise', label: '計画を修正する' }],
    })]);
    await page.setViewportSize({ width: 1280, height });
    await page.addInitScript(({ locale, theme }) => {
      localStorage.setItem('agboard.locale', locale);
      localStorage.setItem('agboard.theme', JSON.stringify({ mode: theme, accent: 'blue' }));
    }, { locale, theme });
    await page.goto(`/?project=${projectId(mainProject)}`);
    await waitForSync(page);
    await expect(page.locator('html')).toHaveAttribute('data-mode', theme);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    const answer = page.locator(`.card__answer[data-task-id="${id}"]`);
    const item = answer.locator('..');
    await expect(answer).toContainText(question);
    await expect(item.getByText(question, { exact: true })).toHaveCount(1);
    await item.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('pending-lane.png') });

    // Visibility alone does not catch clipping by an overflow-hidden flex item.
    const geometry = await item.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const children = [...element.children].map((child) => child.getBoundingClientRect());
      const lane = element.closest('.lane__cards') as HTMLElement;
      return {
        clipped: element.scrollHeight - element.clientHeight,
        childOverflow: Math.max(...children.map((child) => child.bottom)) - bounds.bottom,
        laneScrolls: lane.scrollHeight > lane.clientHeight,
      };
    });
    expect(geometry.clipped).toBeLessThanOrEqual(1);
    expect(geometry.childOverflow).toBeLessThanOrEqual(1);
    expect(geometry.laneScrolls).toBe(true);
    const more = answer.locator('.detail__more');
    if (await more.isVisible()) await more.click();
    const reason = answer.locator('.detail__reason');
    await reason.scrollIntoViewIfNeeded();
    await expect(reason).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath('pending-question.png') });
    const send = answer.getByRole('button', { name: locale === 'ja' ? '送信' : 'Send', exact: true });
    await send.scrollIntoViewIfNeeded();
    await expect(send).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath('pending-answer.png') });
    if (height === 900) await item.screenshot({ path: testInfo.outputPath('pending-card.png') });
    await answer.getByText('この計画を承認する', { exact: true }).click();
    await answer.getByRole('button', { name: locale === 'ja' ? '送信' : 'Send', exact: true }).click();
    await expect(answer).toHaveCount(0);
    const result = JSON.parse(agboardOk(mainProject, ['show', String(id), '--json']).stdout).task;
    expect(result.agentStatus).toBe('idle');
    expect(result.history.at(-1).reason).toContain('この計画を承認する');
  });
}
