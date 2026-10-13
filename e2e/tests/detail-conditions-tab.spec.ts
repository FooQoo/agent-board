import { expect, test } from '@playwright/test';
import path from 'node:path';
import { agboardOk, mainProject, projectId, replaceFileAtomically, resetBoard, workspace } from '../helpers/agboard';
import { createMonitorHome, monitorOrigin, startMonitorServe, stopMonitorServe, removeMonitorHome, type MonitorServe } from '../helpers/monitor';
import { waitForSync } from '../helpers/ui';

function markdown(source: string, count: number) {
  return `---\nacceptance:\n${Array.from({ length: count }, (_, i) => `  - id: AC-${i + 1}\n    text: ${source} check ${i + 1}\n    done: ${i === 0}`).join('\n')}\n---\n\n${source} body.\n\n${'Body paragraph.\n\n'.repeat(40)}`;
}

function seed(project: string, home?: string) {
  agboardOk(project, ['epic', 'add', 'CONDITION-TABS', '--name', 'Conditions epic', '--color', '#7C3AED', '--actor', 'human'], home);
  const folder = workspace(project, home).folder;
  replaceFileAtomically(path.join(folder, 'epics', 'CONDITION-TABS', 'PLAN.md'), markdown('Epic', 4));
  return JSON.parse(agboardOk(project, ['add', 'Conditions detail', '--desc', markdown('Card', 24), '--assignee', 'human', '--actor', 'human', '--epic', 'CONDITION-TABS', '--json'], home).stdout).card.id as number;
}

test.describe('PC condition tab', () => {
  for (const locale of ['en', 'ja'] as const) {
    for (const mode of ['light', 'dark'] as const) {
      test(`${locale}/${mode}: conditions have their own scroll and documents use the full height`, async ({ page }, testInfo) => {
        resetBoard(mainProject);
        const id = seed(mainProject);
        await page.setViewportSize({ width: locale === 'en' ? 1024 : 1280, height: 900 });
        await page.addInitScript(({ locale, mode }) => {
          localStorage.setItem('agboard.locale', locale);
          localStorage.setItem('agboard.theme', JSON.stringify({ mode, accent: 'blue' }));
          localStorage.setItem('agboard.detailWidth', '320');
        }, { locale, mode });
        await page.goto(`/?project=${projectId(mainProject)}`);
        await waitForSync(page);
        await page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) }).click();
        const detail = page.locator('.detail-view');
        await expect(detail.getByRole('tab')).toHaveCount(4);
        await expect(detail.locator('.detail__dock')).toHaveCount(0);
        await expect(detail.getByRole('tabpanel').getByText('Card check 1', { exact: true })).toHaveCount(0);
        const conditionTab = detail.getByRole('tab', { name: locale === 'ja' ? '受け入れ条件' : 'Conditions', exact: true });
        await conditionTab.click();
        const panel = detail.getByRole('tabpanel');
        await expect(panel.getByRole('checkbox')).toHaveCount(28);
        await expect(panel.getByRole('checkbox').first()).toBeDisabled();
        await expect(detail.getByRole('tablist')).toBeInViewport();
        expect(await detail.getByRole('tablist').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        await panel.hover();
        await page.mouse.wheel(0, 2500);
        await expect(panel.getByText('Epic check 4', { exact: true })).toBeInViewport();
        const scroll = await panel.evaluate((el) => el.scrollTop);
        await detail.getByRole('tab', { name: locale === 'ja' ? '本文' : 'Description', exact: true }).click();
        await conditionTab.click();
        expect(await panel.evaluate((el) => el.scrollTop)).toBe(scroll);
        await page.screenshot({ path: testInfo.outputPath('pc-conditions.png') });
      });
    }
  }
});

test.describe('mobile condition tab', () => {
  let home: string;
  let serve: MonitorServe;
  let project: string;
  test.beforeAll(async () => {
    home = createMonitorHome();
    project = projectId('Alpha', home);
    seed('Alpha', home);
    serve = await startMonitorServe(home);
  });
  test.afterAll(async () => {
    await stopMonitorServe(serve);
    removeMonitorHome(home);
  });
  for (const width of [320, 375, 430]) {
    test(`${width}px: swipe follows all four tabs and conditions read the existing epic cache`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 812 });
      await page.addInitScript(() => {
        localStorage.setItem('agboard.locale', 'ja');
        localStorage.setItem('agboard.theme', JSON.stringify({ mode: 'dark', accent: 'blue' }));
      });
      let epicReads = 0;
      page.on('request', (request) => { if (new URL(request.url()).pathname.endsWith('/epics')) epicReads++; });
      await page.goto(`${monitorOrigin}/monitor/?project=${project}`);
      await page.getByRole('button', { name: 'Conditions detail', exact: true }).click();
      const drawer = page.getByRole('dialog');
      await expect(drawer.getByRole('tab')).toHaveCount(4);
      await expect.poll(() => drawer.evaluate((el) => el.getAnimations().length)).toBe(0);
      await expect(drawer.getByText('Card body.')).toBeInViewport();
      await expect(drawer.locator('.monitor-conditions-dock')).toHaveCount(0);
      const viewport = drawer.locator('.monitor-drawer__panels');
      const bounds = (await viewport.boundingBox())!;
      await page.mouse.move(bounds.x + bounds.width * 0.85, bounds.y + 80);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width * 0.15, bounds.y + 80, { steps: 16 });
      await page.mouse.up();
      await expect(drawer.getByRole('tab', { name: '受け入れ条件', exact: true })).toHaveAttribute('aria-selected', 'true');
      const panel = drawer.getByRole('tabpanel', { name: '受け入れ条件', exact: true });
      await expect(panel.getByRole('checkbox')).toHaveCount(28);
      const reads = epicReads;
      await panel.hover();
      await page.mouse.wheel(0, 2500);
      await expect(panel.getByText('Epic check 4', { exact: true })).toBeInViewport();
      await drawer.getByRole('tab', { name: 'エピック', exact: true }).click();
      await expect(drawer.getByRole('tabpanel', { name: 'エピック', exact: true }).getByText('Epic body.')).toBeVisible();
      await drawer.getByRole('tab', { name: '受け入れ条件', exact: true }).click();
      expect(epicReads).toBe(reads);
      const tabBounds = (await drawer.getByRole('tablist').boundingBox())!;
      const indicator = await drawer.locator('.monitor-drawer__tabs').evaluate((el) => {
        const style = getComputedStyle(el, '::after');
        return { width: parseFloat(style.width), x: new DOMMatrixReadOnly(style.transform).m41 };
      });
      expect(indicator.width).toBeCloseTo(tabBounds.width / 4, 0);
      await expect.poll(async () => drawer.locator('.monitor-drawer__tabs').evaluate((el) => {
        const style = getComputedStyle(el, '::after');
        return Math.abs(new DOMMatrixReadOnly(style.transform).m41 - el.clientWidth / 4);
      })).toBeLessThan(1);
      await page.screenshot({ path: testInfo.outputPath('mobile-conditions.png') });
    });
  }
});
