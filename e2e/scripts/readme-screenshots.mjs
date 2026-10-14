import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

// Build web/ and the CLI first. Only disposable sample data is used.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const binary = process.env.AGBOARD_E2E_BINARY ?? path.join(repo, 'target/debug/agboard');
const output = path.join(repo, 'docs/images');
const project = 'website-launch';
mkdirSync(output, { recursive: true });

const copy = {
  en: {
    design: 'Design and review', launch: 'Website launch',
    titles: ['Review the visual design', 'Build the landing page', 'Choose the launch approach',
      'Write the setup guide', 'Prepare release notes', 'Add the project structure',
      'Verify the contact form', 'Check the mobile layout'],
    question: 'How should we launch the new website?',
    choices: ['Share a preview first', 'Publish when checks pass'],
    body: '## Goal\n\nChoose a launch approach that gives the team useful feedback.\n\n## Next step\n\nAnswer the question on the card. The agent will read the decision and prepare the release.',
    checks: ['The goal is clear', 'The work has been verified', 'The result is recorded'],
    plan: '# Website launch\n\n## Goal\n\nPublish a clear, useful website and collect feedback from its first readers.\n\n## Work order\n\nChoose the launch approach, write the setup guide, verify the contact form, then prepare release notes.\n\n## Verification\n\nReview the desktop and mobile layouts. Check the contact flow and record the results before completing each task.',
    epicChecks: ['The launch approach is agreed', 'Desktop and mobile checks pass', 'The release is ready'],
    tab: 'Conditions', ready: 'Connected · Current',
  },
  ja: {
    design: 'デザインと確認', launch: 'Webサイトの公開',
    titles: ['画面のデザインを確認する', 'ランディングページを実装する', '公開の進め方を決める',
      'セットアップガイドを書く', 'リリースノートを準備する', 'プロジェクト構成を整える',
      'お問い合わせフォームを確認する', 'モバイルのレイアウトを確認する'],
    question: 'Webサイトをどのように公開しますか？',
    choices: ['先にプレビューを共有する', '確認が終わったら一般公開する'],
    body: '## 目的\n\n最初の利用者から意見を集められる公開方法を決める。\n\n## 次の作業\n\nカード上の質問に回答してください。AIが判断を読み、公開準備を進めます。',
    checks: ['目的が明確になっている', '動作を確認している', '結果を記録している'],
    plan: '# Webサイトの公開\n\n## 目的\n\n分かりやすく役に立つWebサイトを公開し、最初の利用者から意見を集める。\n\n## 進め方\n\n公開方法を決め、セットアップガイドを書き、お問い合わせフォームを確認してからリリースノートを準備する。\n\n## 確認方法\n\nPCとモバイルのレイアウトを確認する。各タスクの完了前にフォームの動作と確認結果を記録する。',
    epicChecks: ['公開方法が決まっている', 'PCとモバイルの確認が終わっている', '公開準備が整っている'],
    tab: '受け入れ条件', ready: '接続中 · 最新',
  },
};

function markdown(body, checks, completed, priority) {
  const items = checks.map((text, i) => `  - id: AC-${i + 1}\n    text: ${JSON.stringify(text)}\n    done: ${i < completed}`).join('\n');
  return `---\nacceptance:\n${items}\n${priority ? `priority: ${JSON.stringify(priority)}\n` : ''}---\n\n${body}\n`;
}

function cli(home, args) {
  const result = spawnSync(binary, [...args, '--json'], {
    cwd: home, env: { ...process.env, AGBOARD_HOME: home, TZ: 'UTC' }, encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`${args[0]} failed: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

function seed(home, text) {
  const meta = cli(home, ['project', 'create', project]).project;
  const run = (...args) => cli(home, ['--project', project, ...args]);
  for (const [id, name, color] of [['DESIGN', text.design, '#7C3AED'], ['LAUNCH', text.launch, '#008FCC']]) {
    run('epic', 'add', id, '--name', name, '--color', color, '--actor', 'ai');
  }
  for (let i = 0; i < text.titles.length; i++) {
    const done = i === 5 || i === 7;
    const owner = i === 0 || i === 7 ? 'human' : 'ai';
    run('add', text.titles[i], '--assignee', owner, '--actor', 'ai',
      '--epic', [0, 1, 7].includes(i) ? 'DESIGN' : 'LAUNCH',
      '--desc', markdown(text.body, text.checks, done ? 3 : i === 1 ? 2 : 1));
  }
  for (const id of [2, 3, 7]) run('mv', String(id), 'doing', '--actor', 'ai', '--reason', 'Start sample work');
  run('state', '2', 'running', '--actor', 'ai', '--reason', 'Build the landing page');
  run('state', '3', 'pending', '--actor', 'ai', '--request-json', JSON.stringify({
    question: text.question, choices: text.choices.map((label, i) => ({ id: `option-${i + 1}`, label })),
  }));
  // This is a disposable human-owned sample; AI card #6 completes automatically at server startup.
  run('mv', '8', 'done', '--actor', 'human', '--reason', 'Sample mobile review completed');
  run('epic', 'edit', 'LAUNCH', '--plan', markdown(text.plan, text.epicChecks, 1, [3, 4, 7, 5, 6]));
  run('epic', 'edit', 'DESIGN', '--plan', markdown(text.plan, text.epicChecks, 1, [1, 2, 8]));
  return meta.id;
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await exited;
}

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations()
      .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
      .map((a) => a.finished.catch(() => undefined)));
  });
  await page.mouse.move(0, 0);
}

const browser = await chromium.launch();
try {
  for (const locale of ['en', 'ja']) {
    const home = mkdtempSync(path.join(os.tmpdir(), 'agboard-readme-'));
    let server;
    let context;
    try {
      const text = copy[locale];
      const id = seed(home, text);
      const localPort = await freePort();
      const remotePort = await freePort();
      const origin = `http://127.0.0.1:${localPort}`;
      const remote = `http://127.0.0.1:${remotePort}`;
      let stderr = '';
      server = spawn(binary, ['serve', '--port', String(localPort), '--remote-port', String(remotePort),
        '--remote-origin', 'https://screenshots.invalid'], {
        cwd: home, env: { ...process.env, AGBOARD_HOME: home, TZ: 'UTC' }, stdio: ['ignore', 'ignore', 'pipe'],
      });
      server.stderr.on('data', (chunk) => { stderr += chunk; });
      await expect.poll(async () => {
        if (server.exitCode !== null) throw new Error(stderr);
        return fetch(`${origin}/api/health`).then((r) => r.ok).catch(() => false);
      }).toBe(true);
      expect(cli(home, ['--project', project, 'show', '6']).card.cardStatus).toBe('done');
      const progress = cli(home, ['progress']);
      expect(progress.project.id).toBe(id);
      expect(progress.epics.find((epic) => epic.id === 'LAUNCH').cards.map((card) => card.id))
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
      const card = page.getByRole('button', { name: /^#3(?!\d)/ });
      await card.click();
      await expect(page.getByRole('tab')).toHaveCount(4);
      await expect(page.locator('.card__answer').getByText(text.question, { exact: true })).toBeVisible();
      await settle(page);
      await page.screenshot({ path: path.join(output, `board${suffix}.png`) });

      await page.locator('[data-epic-label="LAUNCH"]').first().click();
      const epic = page.locator('.editor-dialog');
      await expect(epic.locator('.ProseMirror')).toBeVisible();
      await expect(epic.locator('.epic-progress__row')).toHaveCount(5);
      await expect(epic.locator('.conditions-dock__head')).toHaveAttribute('aria-expanded', 'false');
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
