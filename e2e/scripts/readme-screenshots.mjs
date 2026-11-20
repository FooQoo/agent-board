import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { setPreferences } from '../helpers/preferences.mjs';
import { cli, copy, project, repo, seed, seedProposal, settle, startServer, stop } from './lib/sample-board.mjs';

// Build web/ and the CLI first. Only disposable sample data is used.
// AGBOARD_MEDIA_OUT points the images at another folder, so a check run does not touch the repository's files.
const output = process.env.AGBOARD_MEDIA_OUT ? path.resolve(process.env.AGBOARD_MEDIA_OUT, 'readme') : path.join(repo, 'docs/images');
mkdirSync(output, { recursive: true });

const browser = await chromium.launch();
try {
  for (const locale of ['en', 'ja']) {
    const home = mkdtempSync(path.join(os.tmpdir(), 'agboard-readme-'));
    let server;
    let context;
    let phoneContext;
    let tabletContext;
    try {
      const text = copy[locale];
      const id = seed(home, text);
      seedProposal(home, text);
      const started = await startServer(home);
      server = started.server;
      const { origin, remote } = started;
      expect(cli(home, ['--project', project, 'show', '6']).task.taskStatus).toBe('done');
      const progress = cli(home, ['progress']);
      expect(progress.project.id).toBe(id);
      expect(progress.epics.find((epic) => epic.id === 'LAUNCH').tasks.map((task) => task.id))
        .toEqual([4, 7, 5]);
      context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, timezoneId: 'UTC' });
      // The language and theme are saved on the board, as the settings screen does.
      await setPreferences(origin, { locale, theme: { mode: 'light', accent: 'blue' } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const suffix = locale === 'ja' ? '.ja' : '';
      await page.goto(`${origin}/?project=${id}`);
      const task = page.getByRole('button', { name: /^#3(?!\d)/ });
      await task.click();
      await expect(page.getByRole('tab')).toHaveCount(5);
      // The waiting card shows only its answer button; the question is read in the answer dialog.
      const answerLabel = locale === 'ja' ? '質問に回答する' : 'Answer the question';
      await expect(page.locator('[data-decision-answer][data-task-id="3"]')).toHaveText(answerLabel);
      await settle(page);
      await page.screenshot({ path: path.join(output, `board${suffix}.png`) });

      await page.locator('[data-epic-label="LAUNCH"]').first().click();
      const epic = page.locator('.editor-dialog');
      await expect(epic.locator('.ProseMirror')).toBeVisible();
      await expect(epic.locator('.epic-progress__row')).toHaveCount(5);
      await expect(epic.locator('.conditions-dock')).toHaveCount(0);
      await settle(page);
      await page.screenshot({ path: path.join(output, `epic${suffix}.png`) });

      // The remote entrance serves the same board app, so a tablet width shows the lanes side by side.
      tabletContext = await browser.newContext({ viewport: { width: 1024, height: 768 }, timezoneId: 'UTC' });
      const tablet = await tabletContext.newPage();
      tablet.on('pageerror', (error) => errors.push(error.message));
      // `open` shrinks the page to phone width; the tablet keeps its own width, so it unlocks the page itself.
      await tablet.goto(`${remote}/?project=${id}`);
      await server.unlockPage(tablet);
      await expect(tablet.locator('[data-decision-answer][data-task-id="3"]')).toHaveText(answerLabel);
      await settle(tablet);
      await tablet.screenshot({ path: path.join(output, `tablet${suffix}.png`) });

      // The phone is a touch device of its own: a long press and a swipe are real touch events.
      phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, timezoneId: 'UTC' });
      const phone = await phoneContext.newPage();
      phone.on('pageerror', (error) => errors.push(error.message));
      await server.open(phone, `${remote}/?project=${id}`);
      await expect(phone.getByRole('status')).toContainText(text.ready);
      const waiting = phone.getByRole('article', { name: /^#3(?!\d)/ });
      // The monitor shows one lane at a time: open Doing, which holds the waiting question's card.
      // The lanes slide when the tab changes: measure and capture only after they stopped moving.
      const stable = async (locator) => {
        let last = '';
        await expect.poll(async () => {
          const now = JSON.stringify(await locator.boundingBox());
          const still = now === last;
          last = now;
          return still;
        }).toBe(true);
      };
      const tabs = phone.getByRole('tablist', { name: locale === 'ja' ? 'レーン' : 'Lanes', exact: true });
      await tabs.getByRole('tab', { name: locale === 'ja' ? /^進行中/ : /^Doing/ }).tap();
      await expect(tabs.getByRole('tab', { selected: true })).toHaveText(locale === 'ja' ? /進行中/ : /Doing/);
      await expect(waiting).toBeVisible();
      await stable(waiting);
      await settle(phone);
      await phone.screenshot({ path: path.join(output, `mobile-cards${suffix}.png`) });
      // A card held for a moment is chosen; sliding it open shows its buttons.
      const swipeCard = phone.locator('[data-swipe-card]').filter({ has: phone.getByRole('article', { name: /^#7(?!\d)/ }) });
      await stable(swipeCard);
      const box = await swipeCard.boundingBox();
      const y = box.y + box.height / 2;
      const cdp = await phoneContext.newCDPSession(phone);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width * 0.8, y }] });
      await expect(swipeCard).toHaveAttribute('data-armed', 'true');
      for (let step = 1; step <= 12; step += 1) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: box.x + box.width * (0.8 - 0.6 * (step / 12)), y }],
        });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
      await expect(swipeCard).toHaveAttribute('data-revealed', 'right');
      await settle(phone);
      await phone.screenshot({ path: path.join(output, `mobile-swipe${suffix}.png`) });
      // The question of the waiting card opens in the messages sheet, with the first choice picked and not yet sent.
      await waiting.getByRole('button', { name: answerLabel, exact: true }).scrollIntoViewIfNeeded();
      await waiting.getByRole('button', { name: answerLabel, exact: true }).click();
      const sheet = phone.getByRole('dialog', { name: locale === 'ja' ? 'メッセージ' : 'Messages', exact: true });
      await expect(sheet.getByText(text.question, { exact: true })).toBeVisible();
      await sheet.getByRole('radio', { name: text.choices[0], exact: true }).click();
      await settle(phone);
      await phone.screenshot({ path: path.join(output, `mobile-question${suffix}.png`) });
      // Later closes the sheet and leaves the question open.
      await sheet.getByRole('button', { name: locale === 'ja' ? 'あとでやる' : 'Later', exact: true }).click();
      await expect(sheet).toHaveCount(0);
      await phone.getByRole('article', { name: /^#3(?!\d)/ }).getByRole('button', { name: text.titles[2], exact: true }).click();
      await expect(phone.getByRole('tab')).toHaveCount(5);
      await phone.getByRole('tab', { name: text.tab, exact: true }).click();
      const panel = phone.getByRole('tabpanel', { name: text.tab, exact: true });
      await expect(panel).toBeVisible();
      // Embla animates with requestAnimationFrame, outside the Web Animations API.
      await expect.poll(async () => {
        const [slide, viewport] = await Promise.all([
          panel.boundingBox(), phone.locator('.monitor-drawer__panels').boundingBox(),
        ]);
        return Math.abs(slide.x - viewport.x);
      }).toBeLessThan(1);
      await settle(phone);
      await phone.screenshot({ path: path.join(output, `mobile${suffix}.png`) });
      expect(errors).toEqual([]);
      console.log(`${locale}: captured board, epic progress, the tablet board, the mobile lane, swipe buttons, question, and drawer; no browser errors.`);
    } finally {
      await phoneContext?.close();
      await tabletContext?.close();
      await context?.close();
      await stop(server);
      rmSync(home, { recursive: true, force: true });
    }
  }
} finally {
  await browser.close();
}
