import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

// Records the English and Japanese demo videos from the real UI.
// Build web/ and the CLI first. Needs ffmpeg and ffprobe. Only disposable data is used.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const binary = process.env.AGBOARD_E2E_BINARY ?? path.join(repo, 'target/debug/agboard');
const output = path.join(repo, 'docs/public/videos');
const project = 'release-demo';
const heroId = 3;
const maxBytes = 6 * 1024 * 1024;
const size = { width: 1280, height: 800 };

const copy = {
  en: {
    epic: 'Release', epicName: 'Product release',
    hero: 'Plan the release rollout',
    others: {
      todoAi: 'Write the release notes', todoHuman: 'Review the pricing page',
      doneHuman: 'Approve the new logo',
      doneAi: 'Set up the staging site',
    },
    body: '## Goal\n\nDecide how the release reaches its first users and record the plan.\n\n## Next step\n\nAgree the rollout approach, then write the release checklist.',
    checks: ['The rollout approach is decided', 'The release checklist is written', 'The result is recorded'],
    question: 'How should we roll out the release?',
    choices: [['preview', 'Share a preview first'], ['publish', 'Publish when the checks pass']],
    reasons: {
      start: 'Start planning the rollout', running: 'Drafting the rollout options',
      resume: 'Preview first was chosen; writing the checklist',
    },
    captions: ['Agent starts the task', 'Agent asks a question', 'You answer on the task',
      'Agent resumes and checks the conditions', 'Done automatically'],
  },
  ja: {
    epic: 'RELEASE', epicName: 'プロダクトのリリース',
    hero: 'リリースの進め方を計画する',
    others: {
      todoAi: 'リリースノートを書く', todoHuman: '料金ページを確認する',
      doneHuman: '新しいロゴを承認する',
      doneAi: 'ステージング環境を用意する',
    },
    body: '## 目的\n\n最初の利用者へどう届けるかを決め、計画を記録する。\n\n## 次の作業\n\n公開方法に合意し、リリースのチェックリストを書く。',
    checks: ['公開方法が決まっている', 'リリースのチェックリストを書いている', '結果を記録している'],
    question: 'リリースをどのように進めますか？',
    choices: [['preview', '先にプレビューを共有する'], ['publish', '確認が終わったら公開する']],
    reasons: {
      start: '公開の進め方の計画に着手する', running: '公開方法の案を整理している',
      resume: '先にプレビューを共有すると決まったので、チェックリストを書く',
    },
    captions: ['エージェントが作業を始める', 'エージェントが質問する', 'タスク上で回答する',
      'エージェントが再開し、受入条件を確認する', '自動で完了'],
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
  const meta = cli(home, ['project', 'create', project]).project;
  const run = (...args) => cli(home, ['--project', project, ...args]);
  run('epic', 'add', text.epic, '--name', text.epicName, '--color', '#008FCC', '--actor', 'ai');
  const o = text.others;
  const add = (title, assignee, completed, epic = true) =>
    run('add', title, '--assignee', assignee, '--actor', assignee, ...(epic ? ['--epic', text.epic] : []),
      '--desc', markdown(text, completed));
  add(o.doneHuman, 'human', 3);
  add(o.todoHuman, 'human', 0);
  add(text.hero, 'ai', 0);
  add(o.todoAi, 'ai', 0);
  add(o.doneAi, 'human', 3, false);
  for (const id of ['1', '5']) run('mv', id, 'done', '--actor', 'human', '--reason', 'Sample work completed');
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
      cwd: home, env: { ...process.env, AGBOARD_HOME: home, TZ: 'UTC' }, stdio: ['ignore', 'ignore', 'pipe'],
    });
    server.stderr.on('data', (chunk) => { stderr += chunk; });
    await expect.poll(async () => {
      if (server.exitCode !== null) throw new Error(stderr);
      return fetch(`${origin}/api/health`).then((r) => r.ok).catch(() => false);
    }).toBe(true);
    const hero = cli(home, ['--project', project, 'show', String(heroId)]).task;
    expect(hero.title).toBe(text.hero);
    expect(hero.taskStatus).toBe('todo');

    const run = (...args) => cli(home, ['--project', project, ...args]);
    context = await browser.newContext({
      viewport: size, timezoneId: 'UTC', recordVideo: { dir: videoDir, size },
    });
    await context.addInitScript((lang) => {
      localStorage.setItem('agboard.locale', lang);
      localStorage.setItem('agboard.theme', JSON.stringify({ mode: 'light', accent: 'blue' }));
    }, locale);
    const created = Date.now();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}/?project=${projectId}`);
    const lanes = page.locator('section.lane');
    const task = page.getByRole('button', { name: new RegExp(`^#${heroId}(?!\\d)`) });
    await expect(lanes).toHaveCount(3);
    await expect(lanes.nth(0).getByRole('button', { name: new RegExp(`^#${heroId}(?!\\d)`) })).toBeVisible();
    await installOverlay(page);
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.mouse.move(size.width - 40, size.height - 120);
    await page.waitForTimeout(600);
    const start = (Date.now() - created) / 1000;

    // 1. The agent starts the task.
    await caption(page, text.captions[0]);
    await page.waitForTimeout(2600);
    run('mv', String(heroId), 'doing', '--actor', 'ai', '--reason', text.reasons.start);
    run('state', String(heroId), 'running', '--actor', 'ai', '--reason', text.reasons.running);
    await expect(lanes.nth(1).getByRole('button', { name: new RegExp(`^#${heroId}(?!\\d)`) })).toBeVisible();
    await expect(task.locator('[data-status="running"], .status--running').first()).toBeVisible()
      .catch(() => undefined);
    await page.waitForTimeout(2800);

    // 2. The agent asks a question.
    await caption(page, text.captions[1]);
    await page.waitForTimeout(1400);
    run('state', String(heroId), 'pending', '--actor', 'ai', '--request-json', JSON.stringify({
      question: text.question, choices: text.choices.map(([id, label]) => ({ id, label })),
    }));
    const answer = page.locator(`.card__answer[data-task-id="${heroId}"]`);
    await expect(answer.getByText(text.question, { exact: true })).toBeVisible();
    await page.waitForTimeout(3200);

    // 3. The user answers in the browser.
    await caption(page, text.captions[2]);
    await page.waitForTimeout(1200);
    const choice = answer.getByRole('radio').first();
    await moveTo(page, choice);
    await page.waitForTimeout(300);
    await choice.click();
    await page.waitForTimeout(1100);
    const send = answer.locator('button[type="submit"]');
    await expect(send).toBeEnabled();
    await moveTo(page, send);
    await page.waitForTimeout(400);
    await send.click();
    await expect(answer).toHaveCount(0);
    await page.mouse.move(size.width - 40, size.height - 120, { steps: 20 });
    await page.waitForTimeout(1500);

    // 4. The agent resumes and checks the conditions one by one.
    await caption(page, text.captions[3]);
    await page.waitForTimeout(1200);
    run('state', String(heroId), 'running', '--actor', 'ai', '--reason', text.reasons.resume);
    await page.waitForTimeout(1500);
    for (let done = 1; done <= 3; done++) {
      run('edit', String(heroId), '--desc', markdown(text, done));
      if (done < 3) {
        await expect(task.locator('.acceptance-chip')).toContainText(`${done}/3`);
        await page.waitForTimeout(1800);
      }
    }

    // 5. The last condition completes the card automatically.
    await caption(page, text.captions[4]);
    await expect(lanes.nth(2).getByRole('button', { name: new RegExp(`^#${heroId}(?!\\d)`) })).toBeVisible();
    await page.waitForTimeout(3600);
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
  tool('ffmpeg', ['-y', '-v', 'error', '-ss', '1.8', '-i', mp4, '-frames:v', '1', '-q:v', '3', poster]);
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
