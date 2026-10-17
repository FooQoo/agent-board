import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { cli, copy, project, repo, seed, settle, startServer, stop } from './lib/sample-board.mjs';

// Build web/ and the CLI first. Only disposable sample data is used.
const output = path.join(repo, 'docs/images');
mkdirSync(output, { recursive: true });

const browser = await chromium.launch();
try {
  for (const locale of ['en', 'ja']) {
    const home = mkdtempSync(path.join(os.tmpdir(), 'agboard-readme-'));
    let server;
    let context;
    try {
      const text = copy[locale];
      const id = seed(home, text);
      const started = await startServer(home);
      server = started.server;
      const { origin, remote } = started;
      expect(cli(home, ['--project', project, 'show', '6']).task.taskStatus).toBe('done');
      const progress = cli(home, ['progress']);
      expect(progress.project.id).toBe(id);
      expect(progress.epics.find((epic) => epic.id === 'LAUNCH').tasks.map((task) => task.id))
        .toEqual([4, 7, 5]);
      context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, timezoneId: 'UTC' });
      await context.addInitScript((lang) => {
        localStorage.setItem('agboard.locale', lang);
        localStorage.setItem('agboard.theme', JSON.stringify({ mode: 'light', accent: 'blue' }));
      }, locale);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const suffix = locale === 'ja' ? '.ja' : '';
      await page.goto(`${origin}/?project=${id}`);
      const task = page.getByRole('button', { name: /^#3(?!\d)/ });
      await task.click();
      await expect(page.getByRole('tab')).toHaveCount(4);
      await expect(page.locator('.card__answer').getByText(text.question, { exact: true })).toBeVisible();
      await expect(page.locator('.detail-view .detail__request')).toHaveCount(0);
      await settle(page);
      await page.screenshot({ path: path.join(output, `board${suffix}.png`) });

      await page.locator('[data-epic-label="LAUNCH"]').first().click();
      const epic = page.locator('.editor-dialog');
      await expect(epic.locator('.ProseMirror')).toBeVisible();
      await expect(epic.locator('.epic-progress__row')).toHaveCount(5);
      await expect(epic.locator('.conditions-dock')).toHaveCount(0);
      await settle(page);
      await page.screenshot({ path: path.join(output, `epic${suffix}.png`) });

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${remote}/monitor/?project=${id}`);
      await expect(page.getByRole('status')).toContainText(text.ready);
      await page.getByRole('article', { name: /^#3(?!\d)/ }).getByRole('button', { name: text.titles[2], exact: true }).click();
      await expect(page.getByRole('tab')).toHaveCount(4);
      await page.getByRole('tab', { name: text.tab, exact: true }).click();
      const panel = page.getByRole('tabpanel', { name: text.tab, exact: true });
      await expect(panel).toBeVisible();
      // Embla animates with requestAnimationFrame, outside the Web Animations API.
      await expect.poll(async () => {
        const [slide, viewport] = await Promise.all([
          panel.boundingBox(), page.locator('.monitor-drawer__panels').boundingBox(),
        ]);
        return Math.abs(slide.x - viewport.x);
      }).toBeLessThan(1);
      await settle(page);
      await page.screenshot({ path: path.join(output, `mobile${suffix}.png`) });
      expect(errors).toEqual([]);
      console.log(`${locale}: captured board, epic progress, and mobile drawer; no browser errors.`);
    } finally {
      await context?.close();
      await stop(server);
      rmSync(home, { recursive: true, force: true });
    }
  }
} finally {
  await browser.close();
}
