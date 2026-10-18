import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { cli, copy, markdown, project, repo, seed, settle, startServer, stop } from './lib/sample-board.mjs';

// Captures the screenshots used by the guide pages into docs/images/guide.
// Build web/ and the CLI first. Only disposable sample data and free loopback ports are used.
const output = path.join(repo, 'docs/images/guide');
mkdirSync(output, { recursive: true });

// Texts that only the guide screenshots need, in both languages. UI labels come from the app itself.
const extra = {
  en: {
    editorTask: 3, // The card whose edit dialog is captured (index into copy.titles).
    editorBody: '## Goal\n\nWrite a setup guide that a new teammate can follow without help.\n\n## Flow\n\n```mermaid\nflowchart LR\n  Outline --> Write --> Try --> Publish\n```\n\n## Tasks\n\n- [x] Outline the steps\n- [ ] Write each step with an example\n- [ ] Ask a teammate to try the guide\n',
    editorChecks: ['The steps are complete', 'A teammate followed the guide', 'The guide is published'],
    archived: ['Set up the repository', 'Choose the color palette', 'Write the first draft'],
    archive: { trigger: 'Archive completed tasks', submit: /^Archive \d+ tasks$/, open: 'Archive', doneLane: 'Done' },
    makeDraft: 'Make draft', edit: 'Edit task', settings: 'Settings', cancel: 'Cancel',
    addCard: 'Add task', promptLabel: 'What should be done?', epicLabel: 'Epic (optional)',
    attachLabel: 'Image attachments', requestText: 'Review the attached logo and prepare a short launch checklist.',
    discard: 'Discard and close',
  },
  ja: {
    editorTask: 3,
    editorBody: '## 目的\n\n新しいメンバーが一人で進められるセットアップガイドを書く。\n\n## 流れ\n\n```mermaid\nflowchart LR\n  構成 --> 執筆 --> 確認 --> 公開\n```\n\n## 作業\n\n- [x] 手順の構成を決める\n- [ ] 各手順に例を添えて書く\n- [ ] チームメンバーに試してもらう\n',
    editorChecks: ['手順がそろっている', 'メンバーがガイドどおりに進められた', 'ガイドを公開している'],
    archived: ['リポジトリを準備する', '配色を決める', '最初の下書きを書く'],
    archive: { trigger: '完了タスクをアーカイブ', submit: /^\d+件をアーカイブ$/, open: 'アーカイブ', doneLane: '完了' },
    makeDraft: '下書きにする', edit: 'タスクを編集', settings: '設定', cancel: 'キャンセル',
    addCard: 'タスク追加', promptLabel: '何をしてほしいですか？', epicLabel: 'エピック（任意）',
    attachLabel: '画像添付', requestText: '添付したロゴを確認して、公開前の短いチェックリストを作成してください。',
    discard: '破棄して閉じる',
  },
};

function addSamples(home, id, text, more) {
  const run = (...args) => cli(home, ['--project', project, ...args]);
  run('edit', String(more.editorTask + 1), '--desc',
    markdown(more.editorBody, more.editorChecks, 1));
  for (const title of more.archived) {
    const added = run('add', title, '--assignee', 'human', '--actor', 'human', '--epic', 'DESIGN');
    run('mv', String((added.task ?? added).id), 'done', '--actor', 'human', '--reason', 'Sample work completed');
  }
  return id;
}

const browser = await chromium.launch();
try {
  for (const locale of ['en', 'ja']) {
    const home = mkdtempSync(path.join(os.tmpdir(), 'agboard-docs-'));
    let server;
    const contexts = [];
    try {
      const text = copy[locale];
      const more = extra[locale];
      const id = addSamples(home, seed(home, text), text, more);
      const started = await startServer(home);
      server = started.server;
      const { origin } = started;
      const open = async (mode) => {
        const ctx = await browser.newContext({
          viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, timezoneId: 'UTC',
        });
        contexts.push(ctx);
        await ctx.addInitScript(([lang, value]) => {
          localStorage.setItem('agboard.locale', lang);
          localStorage.setItem('agboard.theme', JSON.stringify({ mode: value, accent: 'blue' }));
        }, [locale, mode]);
        const tab = await ctx.newPage();
        tab.on('pageerror', (error) => errors.push(error.message));
        await tab.goto(`${origin}/?project=${id}`);
        return tab;
      };
      const errors = [];
      const suffix = locale === 'ja' ? '.ja' : '';
      const shot = async (name, target, tab) => {
        await settle(tab);
        await target.screenshot({ path: path.join(output, `${name}${suffix}.png`) });
      };
      const page = await open('light');
      const task = (n) => page.getByRole('button', { name: new RegExp(`^#${n}(?!\\d)`) });

      // task-request: a real short request with an optional epic and image.
      await page.getByRole('button', { name: more.addCard, exact: true }).click();
      const request = page.getByRole('dialog', { name: locale === 'ja' ? '新しいタスク' : 'New task' });
      await request.getByRole('textbox', { name: more.promptLabel }).fill(more.requestText);
      await request.getByRole('button', { name: more.epicLabel }).click();
      await page.getByRole('menuitemradio', { name: text.design, exact: true }).click();
      await request.locator('input[type="file"]').setInputFiles(path.join(repo, 'docs/public/logo.png'));
      await expect(request.getByRole('button', {
        name: locale === 'ja' ? 'logo.pngをプレビュー' : 'Preview logo.png',
      })).toBeVisible();
      await expect(request.getByRole('region', { name: more.attachLabel })).toBeVisible();
      await expect(request.getByText('logo.png', { exact: true })).toBeVisible();
      await expect(request.getByRole('button', {
        name: locale === 'ja' ? 'logo.pngを削除' : 'Remove logo.png',
      })).toBeVisible();
      const tileBox = await request.locator('.editor-attachments__tile').boundingBox();
      const listBox = await request.locator('.editor-attachments__list').boundingBox();
      if (!tileBox || tileBox.width < 100 || tileBox.height < 80 || !listBox || listBox.height < 120) {
        throw new Error(`The attached image tile is not visibly laid out: ${JSON.stringify(tileBox)}`);
      }
      await shot('task-request', request, page);
      await request.getByRole('button', { name: more.cancel, exact: true }).click();
      await page.getByRole('dialog', { name: locale === 'ja' ? '変更を破棄しますか?' : 'Discard changes?' })
        .getByRole('button', { name: more.discard, exact: true }).click();
      await expect(request).toHaveCount(0);

      // question: the Pending card with its answer field.
      await expect(task(3)).toBeVisible();
      const answer = page.locator('.card__answer').filter({ has: page.getByText(text.question, { exact: true }) });
      await expect(answer).toBeVisible();
      // A tall viewport keeps the lane from clipping the card (answer buttons included).
      await page.setViewportSize({ width: 1440, height: 1600 });
      await shot('question', page.locator('.card__item').filter({ has: answer }), page);
      await page.setViewportSize({ width: 1440, height: 900 });

      // card-detail: the Conditions tab of the selected card.
      await task(3).click();
      await page.getByRole('tab', { name: text.tab, exact: true }).click();
      await expect(page.getByRole('tabpanel', { name: text.tab, exact: true })).toBeVisible();
      await expect(page.getByRole('tab', { name: text.tab, exact: true })).toHaveAttribute('aria-selected', 'true');
      await shot('card-detail', page, page);

      // board-dark: the whole board in the dark theme, in its own browser context.
      const dark = await open('dark');
      await expect(dark.getByRole('button', { name: /^#3(?!\d)/ })).toBeVisible();
      await expect(dark.locator('html')).toHaveAttribute('data-mode', 'dark');
      await shot('board-dark', dark, dark);

      // settings: the language and theme choices.
      await page.getByRole('button', { name: more.settings, exact: true }).click();
      const settings = page.getByRole('dialog', { name: more.settings });
      await expect(settings).toBeVisible();
      await expect(settings.getByRole('radio').first()).toBeVisible();
      await shot('settings', page, page);
      await page.keyboard.press('Escape');
      await expect(settings).toHaveCount(0);

      // editor: a draft card with a task list and a Mermaid diagram, conditions panel expanded.
      await task(4).click();
      await page.getByRole('button', { name: more.makeDraft, exact: true }).click();
      await page.getByRole('button', { name: more.edit, exact: true }).click();
      const editor = page.locator('.editor-dialog');
      await expect(editor.locator('.ProseMirror')).toBeVisible();
      await editor.locator('.conditions-dock__head').click();
      await expect(editor.locator('.conditions-dock__head')).toHaveAttribute('aria-expanded', 'true');
      await expect(editor.locator('.ProseMirror h2').first()).toBeVisible();
      await expect(editor.locator('.rich-mermaid svg').first()).toBeVisible();
      await shot('editor', page, page);
      await editor.getByRole('button', { name: more.cancel, exact: true }).click();
      await expect(editor).toHaveCount(0);

      // archive: archive the completed cards, then open the archive list.
      await page.locator('.lane-header__archive').click();
      const confirm = page.getByRole('dialog');
      await expect(confirm).toBeVisible();
      await confirm.getByRole('button', { name: more.archive.submit }).click();
      await expect(confirm).toHaveCount(0);
      await page.locator('.header__archive').click();
      await expect(page.locator('.archive-row > button')).toHaveCount(2 + more.archived.length);
      await shot('archive', page, page);

      // epic-list: every epic with its task counts, and the plan of one beside the list.
      await page.locator('.header__back').click();
      await page.locator('.header__epics').click();
      // The two default epics and the two sample epics.
      await expect(page.locator('.epic-row > button')).toHaveCount(4);
      await page.locator('.epic-row > button').filter({ hasText: 'LAUNCH' }).click();
      await expect(page.locator('.epic-detail')).toBeVisible();
      await shot('epic-list', page, page);

      expect(errors).toEqual([]);
      console.log(`${locale}: captured 8 guide screenshots; no browser errors.`);
    } finally {
      await Promise.all(contexts.map((ctx) => ctx.close()));
      await stop(server);
      rmSync(home, { recursive: true, force: true });
    }
  }
} finally {
  await browser.close();
}
