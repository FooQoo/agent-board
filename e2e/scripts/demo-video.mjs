import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { setPreferences } from '../helpers/preferences.mjs';

// Records the English and Japanese demo videos from the real UI.
// Build web/ and the CLI first. Needs ffmpeg and ffprobe. Only disposable data is used.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const binary = process.env.AGBOARD_E2E_BINARY ?? path.join(repo, 'target/debug/agboard');
// AGBOARD_MEDIA_OUT points the videos at another folder, so a check run does not touch the repository's files.
const output = process.env.AGBOARD_MEDIA_OUT ? path.resolve(process.env.AGBOARD_MEDIA_OUT, 'videos') : path.join(repo, 'docs/public/videos');
const project = 'release-demo';
// The board has three earlier cards; the agent's plan adds tasks 4 to 6, and the first is followed.
const heroId = 4;
const maxBytes = 6 * 1024 * 1024;
const size = { width: 1280, height: 800 };

// UI labels are the app's own; the rest is sample text in each language.
const copy = {
  en: {
    ui: { askAi: 'Ask AI', prompt: 'What would you like done?', send: 'Send request', answer: 'Send answer', close: 'Close' },
    request: 'Plan the product launch and get it ready to ship.',
    epic: 'LAUNCH', epicName: 'Product launch',
    plan: ['Decide the rollout approach', 'Write the release notes', 'Prepare the launch checklist'],
    earlier: { doneHuman: 'Approve the new logo', doneAi: 'Set up the staging site', todoHuman: 'Review the pricing page' },
    body: '## Goal\n\nDecide how the launch reaches its first users.\n\n## Next step\n\nAgree the rollout approach, then record it in the plan.',
    checks: ['The rollout approach is decided', 'The plan is updated', 'The result is recorded'],
    question: 'How should we roll out the launch?',
    choices: [['preview', 'Share a preview first'], ['publish', 'Publish when the checks pass']],
    reasons: {
      start: 'Start the rollout decision', running: 'Writing up the rollout approach',
      resume: 'Preview first was chosen; updating the plan',
    },
    captions: ['Ask AI for what you want', 'The agent turns it into tasks', 'Answer when the agent asks',
      'The agent starts and checks its conditions', 'Done automatically'],
  },
  ja: {
    ui: { askAi: 'AI に依頼', prompt: '何をしてほしいですか？', send: '依頼する', answer: '回答を送る', close: '閉じる' },
    request: 'プロダクトの公開を計画して、公開できる状態まで進めてください。',
    epic: 'LAUNCH', epicName: 'プロダクトの公開',
    plan: ['公開の進め方を決める', 'リリースノートを書く', '公開前のチェックリストを用意する'],
    earlier: { doneHuman: '新しいロゴを承認する', doneAi: 'ステージング環境を用意する', todoHuman: '料金ページを確認する' },
    body: '## 目的\n\n最初の利用者へどう届けるかを決める。\n\n## 次の作業\n\n公開の進め方に合意し、計画に記録する。',
    checks: ['公開の進め方が決まっている', '計画を更新している', '結果を記録している'],
    question: '公開をどのように進めますか？',
    choices: [['preview', '先にプレビューを共有する'], ['publish', '確認が終わったら公開する']],
    reasons: {
      start: '公開の進め方の決定に着手する', running: '公開の進め方をまとめている',
      resume: '先にプレビューを共有すると決まったので、計画を更新する',
    },
    captions: ['やってほしいことを AI に依頼', 'エージェントがタスクに分ける', '質問が来たら回答する',
      'エージェントが着手し、完了条件を確認する', '自動で完了'],
  },
};

function markdown(text, completed) {
  const items = text.checks
    .map((check, i) => `  - id: AC-${i + 1}\n    text: ${JSON.stringify(check)}\n    done: ${i < completed}`)
    .join('\n');
  return `---\nacceptance:\n${items}\n---\n\n${text.body}\n`;
}

function cli(home, args) {
  const result = spawnSync(binary, [...args, '--json'], {
    cwd: home, env: { ...process.env, AGBOARD_HOME: home, TZ: 'UTC' }, encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

function seed(home, text) {
  // The first-run guide is skipped, so the video opens on the board, as the screenshot seed does.
  const internal = path.join(home, 'shared', '.internal');
  mkdirSync(internal, { recursive: true });
  writeFileSync(
    path.join(internal, 'onboarding.json'),
    JSON.stringify({ formatVersion: 2, status: 'skipped' }),
  );
  const meta = cli(home, ['project', 'create', project]).project;
  const run = (...args) => cli(home, ['--project', project, ...args]);
  const e = text.earlier;
  // Earlier work, so the board is not empty: two finished cards and one of yours still to do.
  run('add', e.doneHuman, '--assignee', 'human', '--actor', 'human');
  run('add', e.doneAi, '--assignee', 'ai', '--actor', 'ai');
  run('start', '2', '--actor', 'ai');
  run('add', e.todoHuman, '--assignee', 'human', '--actor', 'human');
  for (const id of ['1', '2']) run('mv', id, 'done', '--actor', 'human', '--reason', 'Sample work completed');
  return meta.id;
}

async function freePort(preferred = 0) {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(preferred, '127.0.0.1', resolve); });
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

function tool(name, args) {
  const result = spawnSync(name, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`${name} failed (${result.status}): ${result.error?.message ?? result.stderr}`);
  }
  return result.stdout;
}

// Fixed overlays drawn by this script only: scene captions and a pointer (recordings hide the real cursor).
async function installOverlay(page) {
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `
      #demo-caption { position: fixed; left: 50%; bottom: 14px; transform: translate(-50%, 8px); z-index: 2147483647;
        max-width: calc(100% - 64px); padding: 9px 26px; border-radius: 999px; background: rgba(15, 23, 42, 0.92);
        color: #fff; font: 600 24px/1.3 system-ui, -apple-system, "Hiragino Sans", "Noto Sans CJK JP", sans-serif;
        letter-spacing: 0.01em; text-align: center; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
        opacity: 0; transition: opacity 0.35s ease, transform 0.35s ease; pointer-events: none; }
      #demo-caption[data-on="true"] { opacity: 1; transform: translate(-50%, 0); }
      #demo-pointer { position: fixed; left: 0; top: 0; width: 22px; height: 22px; margin: -4px 0 0 -4px;
        z-index: 2147483647; pointer-events: none; opacity: 0; transition: opacity 0.2s ease; }
      #demo-pointer svg { width: 100%; height: 100%; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5)); }`;
    document.head.append(style);
    const caption = document.createElement('div');
    caption.id = 'demo-caption';
    caption.setAttribute('aria-hidden', 'true');
    const pointer = document.createElement('div');
    pointer.id = 'demo-pointer';
    pointer.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 2l7.5 19 2.7-7.8L21 10.5z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.append(caption, pointer);
    document.addEventListener('mousemove', (event) => {
      pointer.style.opacity = '1';
      pointer.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
    }, true);
  });
}

async function caption(page, textValue) {
  await page.evaluate((value) => {
    const element = document.getElementById('demo-caption');
    element.dataset.on = 'false';
    setTimeout(() => { element.textContent = value; element.dataset.on = 'true'; }, 250);
  }, textValue);
}

async function moveTo(page, locator) {
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 28 });
}

async function record(browser, locale, tmp) {
  const text = copy[locale];
  const home = path.join(tmp, `home-${locale}`);
  mkdirSync(home);
  const videoDir = path.join(tmp, `video-${locale}`);
  let server;
  let context;
  try {
    const projectId = seed(home, text);
    const port = await freePort(Number(process.env.AGBOARD_MEDIA_PORT ?? 0));
    const origin = `http://127.0.0.1:${port}`;
    let stderr = '';
    server = spawn(binary, ['serve', '--port', String(port)], {
      cwd: home, env: { ...process.env, AGBOARD_HOME: home, TZ: 'UTC', AGBOARD_WATCH: 'poll' }, stdio: ['ignore', 'ignore', 'pipe'],
    });
    server.stderr.on('data', (chunk) => { stderr += chunk; });
    await expect.poll(async () => {
      if (server.exitCode !== null) throw new Error(stderr);
      return fetch(`${origin}/api/health`).then((r) => r.ok).catch(() => false);
    }).toBe(true);
    const run = (...args) => cli(home, ['--project', project, ...args]);
    context = await browser.newContext({
      viewport: size, timezoneId: 'UTC', recordVideo: { dir: videoDir, size },
    });
    // The language and theme are saved on the board, as the settings screen does.
    await setPreferences(origin, { locale, theme: { mode: 'light', accent: 'blue' } });
    const created = Date.now();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}/?project=${projectId}`);
    const lanes = page.locator('section.lane');
    const card = (id) => page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });
    const task = card(heroId);
    await expect(lanes).toHaveCount(3);
    await expect(card(3)).toBeVisible();
    await installOverlay(page);
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.mouse.move(size.width - 40, size.height - 120);
    await page.waitForTimeout(600);
    const start = (Date.now() - created) / 1000;

    // 1. You ask for the work in your own words.
    await caption(page, text.captions[0]);
    await page.waitForTimeout(1200);
    const askButton = page.getByRole('button', { name: text.ui.askAi, exact: true });
    await moveTo(page, askButton);
    await page.waitForTimeout(250);
    await askButton.click();
    const ask = page.getByRole('dialog', { name: text.ui.askAi });
    const field = ask.getByRole('textbox', { name: text.ui.prompt });
    await expect(field).toBeVisible();
    await field.click();
    await field.pressSequentially(text.request, { delay: locale === 'ja' ? 55 : 28 });
    await page.waitForTimeout(500);
    const send = ask.getByRole('button', { name: text.ui.send, exact: true });
    await moveTo(page, send);
    await page.waitForTimeout(250);
    await send.click();
    await expect(ask).toBeHidden();
    await page.mouse.move(size.width - 40, size.height - 120, { steps: 20 });
    await page.waitForTimeout(1200);

    // 2. The agent takes the request and puts its plan on the board as draft tasks.
    await caption(page, text.captions[1]);
    await page.waitForTimeout(900);
    const request = run('message', 'ls').messages.find((message) => message.type === 'request');
    run('message', 'accept', request.id, '--actor', 'ai');
    run('epic', 'add', text.epic, '--name', text.epicName, '--color', '#008FCC', '--actor', 'ai');
    for (const title of text.plan) {
      run('add', title, '--assignee', 'ai', '--actor', 'ai', '--epic', text.epic, `--desc=${markdown(text, 0)}`);
      await page.waitForTimeout(650);
    }
    await expect(task).toBeVisible();
    await page.waitForTimeout(1600);

    // 3. The agent asks what only you can decide, and you answer on the card.
    await caption(page, text.captions[2]);
    await page.waitForTimeout(900);
    run('message', 'ask', '--actor', 'ai', '--task', String(heroId), '--no-wait', '--questions-json', JSON.stringify({
      questions: [{ body: text.question, choices: text.choices.map(([id, label]) => ({ id, label })) }],
    }));
    const answerButton = page.locator(`[data-decision-answer][data-task-id="${heroId}"]`);
    await expect(answerButton).toBeVisible();
    await page.waitForTimeout(1400);
    await moveTo(page, answerButton);
    await page.waitForTimeout(250);
    await answerButton.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('.decision-panel')).toContainText(text.question);
    await page.waitForTimeout(700);
    const choice = dialog.getByRole('radio').first();
    await moveTo(page, choice);
    await page.waitForTimeout(250);
    await choice.click();
    await page.waitForTimeout(700);
    const answer = dialog.getByRole('button', { name: text.ui.answer, exact: true });
    await expect(answer).toBeEnabled();
    await moveTo(page, answer);
    await page.waitForTimeout(300);
    await answer.click();
    // The answered card closes its dialog, or returns to the message list when more is open there.
    const listShown = await dialog.getByRole('tablist').waitFor({ timeout: 2500 }).then(() => true, () => false);
    if (listShown) {
      await page.waitForTimeout(700);
      const close = dialog.getByRole('button', { name: text.ui.close, exact: true }).first();
      await moveTo(page, close);
      await close.click();
    }
    await expect(dialog).toBeHidden();
    await expect(answerButton).toHaveCount(0);
    await page.mouse.move(size.width - 40, size.height - 120, { steps: 20 });
    await page.waitForTimeout(1000);

    // 4. The agent starts its plan and works through the first task's conditions.
    await caption(page, text.captions[3]);
    await page.waitForTimeout(900);
    for (const offset of [0, 1, 2]) run('start', String(heroId + offset), '--actor', 'ai');
    run('mv', String(heroId), 'doing', '--actor', 'ai', '--reason', text.reasons.start);
    run('state', String(heroId), 'running', '--actor', 'ai', '--reason', text.reasons.resume);
    await expect(lanes.nth(1).getByRole('button', { name: new RegExp(`^#${heroId}(?!\\d)`) })).toBeVisible();
    await page.waitForTimeout(1600);
    for (let done = 1; done <= 3; done++) {
      run('edit', String(heroId), `--desc=${markdown(text, done)}`);
      if (done < 3) {
        await expect(task.locator('.acceptance-chip')).toContainText(`${done}/3`);
        await page.waitForTimeout(1300);
      }
    }

    // 5. The last condition completes the card on its own.
    await caption(page, text.captions[4]);
    await expect(lanes.nth(2).getByRole('button', { name: new RegExp(`^#${heroId}(?!\\d)`) })).toBeVisible();
    await page.waitForTimeout(800);
    run('mv', String(heroId + 1), 'doing', '--actor', 'ai', '--reason', text.reasons.start);
    run('state', String(heroId + 1), 'running', '--actor', 'ai', '--reason', text.reasons.running);
    await page.waitForTimeout(2600);
    const end = (Date.now() - created) / 1000;
    expect(run('show', String(heroId)).task.taskStatus).toBe('done');
    expect(errors).toEqual([]);

    await context.close();
    context = undefined;
    const webm = readdirSync(videoDir).find((name) => name.endsWith('.webm'));
    return { webm: path.join(videoDir, webm), start, end };
  } finally {
    await context?.close().catch(() => undefined);
    await stop(server);
  }
}

function encode(source, start, end, suffix) {
  const mp4 = path.join(output, `demo${suffix}.mp4`);
  const poster = path.join(output, `demo${suffix}.jpg`);
  for (const crf of [23, 26, 29, 32, 35]) {
    tool('ffmpeg', ['-y', '-v', 'error', '-ss', start.toFixed(2), '-t', (end - start).toFixed(2), '-i', source,
      '-vf', 'fps=30,scale=1280:800:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow',
      '-crf', String(crf), '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', mp4]);
    if (statSync(mp4).size <= maxBytes) break;
  }
  tool('ffmpeg', ['-y', '-v', 'error', '-ss', '10', '-i', mp4, '-frames:v', '1', '-q:v', '3', poster]);
  const probe = JSON.parse(tool('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,pix_fmt',
    '-show_entries', 'format=duration', '-of', 'json', mp4]));
  const streams = probe.streams;
  const duration = Number(probe.format.duration);
  if (streams.length !== 1 || streams[0].codec_name !== 'h264' || streams[0].pix_fmt !== 'yuv420p') {
    throw new Error(`Unexpected streams in ${mp4}: ${JSON.stringify(streams)}`);
  }
  if (duration < 20 || duration > 40) throw new Error(`Duration ${duration}s of ${mp4} is outside 20-40 s`);
  if (statSync(mp4).size > maxBytes) throw new Error(`${mp4} is larger than 6 MB`);
  return { mp4, duration };
}

const tmp = mkdtempSync(path.join(os.tmpdir(), 'agboard-demo-'));
let browser;
try {
  mkdirSync(output, { recursive: true });
  browser = await chromium.launch();
  for (const locale of ['en', 'ja']) {
    const { webm, start, end } = await record(browser, locale, tmp);
    const { mp4, duration } = encode(webm, start, end, locale === 'ja' ? '.ja' : '');
    console.log(`${locale}: wrote ${path.relative(repo, mp4)} (${duration.toFixed(1)} s, ${(statSync(mp4).size / 1024).toFixed(0)} KiB); no browser errors.`);
  }
} finally {
  await browser?.close();
  rmSync(tmp, { recursive: true, force: true });
}
