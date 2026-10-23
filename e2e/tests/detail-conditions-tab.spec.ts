import { expect, test } from '@playwright/test';
import path from 'node:path';
import { agboardOk, mainProject, projectId, replaceFileAtomically, resetBoard, workspace } from '../helpers/agboard';
import { resetPreferences, setPreferences } from '../helpers/preferences';
import { readBoardAfterReset, waitForSync } from '../helpers/ui';

test.beforeEach(() => resetPreferences());
test.afterEach(() => resetPreferences());

function markdown(source: string, count: number) {
  return `---\nacceptance:\n${Array.from({ length: count }, (_, i) => `  - id: AC-${i + 1}\n    text: ${source} check ${i + 1}\n    done: ${i === 0}`).join('\n')}\n---\n\n${source} body.\n\n${'Body paragraph.\n\n'.repeat(40)}`;
}

function seed(project: string, home?: string) {
  agboardOk(project, ['epic', 'add', 'CONDITION-TABS', '--name', 'Conditions epic', '--color', '#7C3AED', '--actor', 'human'], home);
  const folder = workspace(project, home).folder;
  replaceFileAtomically(path.join(folder, 'epics', 'CONDITION-TABS', 'EPIC.md'), 'Epic body.\n\n## Reference conditions\n\n- [ ] Epic reference check.\n');
  return JSON.parse(agboardOk(project, ['add', 'Conditions detail', '--desc', markdown('Task', 24), '--assignee', 'human', '--actor', 'human', '--epic', 'CONDITION-TABS', '--json'], home).stdout).task.id as number;
}

test.describe('PC condition tab', () => {
  for (const locale of ['en', 'ja'] as const) {
    for (const mode of ['light', 'dark'] as const) {
      test(`${locale}/${mode}: conditions have their own scroll and documents use the full height`, async ({ page }, testInfo) => {
        resetBoard(mainProject);
        const id = seed(mainProject);
        await page.setViewportSize({ width: locale === 'en' ? 1024 : 1280, height: 900 });
        await setPreferences({ locale, theme: { mode, accent: 'blue' } });
        await page.addInitScript(() => localStorage.setItem('agboard.detailWidth', '320'));
        await page.goto(`/?project=${projectId(mainProject)}`);
        await waitForSync(page);
        await readBoardAfterReset(page);
        await page
          .getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) })
          .locator('.card__title')
          .click();
        const detail = page.locator('.detail-view');
        await expect(detail.getByRole('tab')).toHaveCount(4);
        await expect(detail.locator('.detail__dock')).toHaveCount(0);
        await expect(detail.getByRole('tabpanel').getByText('Task check 1', { exact: true })).toHaveCount(0);
        const conditionTab = detail.getByRole('tab', { name: locale === 'ja' ? '受入条件' : 'Conditions', exact: true });
        await conditionTab.click();
        const panel = detail.getByRole('tabpanel');
        await expect(panel.getByRole('checkbox')).toHaveCount(24);
        await expect(panel.getByRole('checkbox').first()).toBeDisabled();
        await expect(detail.getByRole('tablist')).toBeInViewport();
        expect(await detail.getByRole('tablist').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        await panel.hover();
        await page.mouse.wheel(0, 2500);
        await expect(panel.getByText('Task check 24', { exact: true })).toBeInViewport();
        await expect(panel.getByText('Epic reference check.', { exact: true })).toHaveCount(0);
        const scroll = await panel.evaluate((el) => el.scrollTop);
        await detail.getByRole('tab', { name: locale === 'ja' ? '本文' : 'Description', exact: true }).click();
        await conditionTab.click();
        expect(await panel.evaluate((el) => el.scrollTop)).toBe(scroll);
        await page.screenshot({ path: testInfo.outputPath('pc-conditions.png') });
      });
    }
  }
});
