import { spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPhoneEntrance } from '../../helpers/phone-entrance.mjs';

// Shared disposable sample board for the screenshot scripts. Build web/ and the CLI first.
export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const binary = process.env.AGBOARD_E2E_BINARY ?? path.join(repo, 'target/debug/agboard');
export const project = 'website-launch';

export const copy = {
  en: {
    design: 'Design and review', launch: 'Website launch',
    titles: ['Review the visual design', 'Build the landing page', 'Choose the launch approach',
      'Write the setup guide', 'Prepare release notes', 'Add the project structure',
      'Verify the contact form', 'Check the mobile layout'],
    question: 'How should we launch the new website?',
    choices: ['Share a preview first', 'Publish when checks pass'],
    body: '## Goal\n\nChoose a launch approach that gives the team useful feedback.\n\n## Next step\n\nRecord the agreed launch approach and prepare a release checklist.',
    checks: ['The goal is clear', 'The work has been verified', 'The result is recorded'],
    plan: '# Website launch\n\n## Goal\n\nPublish a clear, useful website and collect feedback from its first readers.\n\n## Work order\n\nChoose the launch approach, write the setup guide, verify the contact form, then prepare release notes.\n\n## Verification\n\nReview the desktop and mobile layouts. Check the contact flow and record the results before completing each task.',
    epicChecks: ['The launch approach is agreed', 'Desktop and mobile checks pass', 'The release is ready'],
    tab: 'Conditions', ready: 'Connected · Current',
    workNote: 'Reviewed the launch options and recorded the decision criteria.',
  },
  ja: {
    design: 'デザインと確認', launch: 'Webサイトの公開',
    titles: ['画面のデザインを確認する', 'ランディングページを実装する', '公開の進め方を決める',
      'セットアップガイドを書く', 'リリースノートを準備する', 'プロジェクト構成を整える',
      'お問い合わせフォームを確認する', 'モバイルのレイアウトを確認する'],
    question: 'Webサイトをどのように公開しますか？',
    choices: ['先にプレビューを共有する', '確認が終わったら一般公開する'],
    body: '## 目的\n\n最初の利用者から意見を集められる公開方法を決める。\n\n## 次の作業\n\n合意した公開方法を記録し、公開前のチェックリストを準備する。',
    checks: ['目的が明確になっている', '動作を確認している', '結果を記録している'],
    plan: '# Webサイトの公開\n\n## 目的\n\n分かりやすく役に立つWebサイトを公開し、最初の利用者から意見を集める。\n\n## 進め方\n\n公開方法を決め、セットアップガイドを書き、お問い合わせフォームを確認してからリリースノートを準備する。\n\n## 確認方法\n\nPCとモバイルのレイアウトを確認する。各タスクの完了前にフォームの動作と確認結果を記録する。',
    epicChecks: ['公開方法が決まっている', 'PCとモバイルの確認が終わっている', '公開準備が整っている'],
    tab: '受入条件', ready: '接続中 · 最新',
    workNote: '公開方法を比較し、判断に使う条件を記録しました。',
  },
};

export function markdown(body, checks, completed, priority) {
  const items = checks.map((text, i) => `  - id: AC-${i + 1}\n    text: ${JSON.stringify(text)}\n    done: ${i < completed}`).join('\n');
  return `---\nacceptance:\n${items}\n${priority ? `priority: ${JSON.stringify(priority)}\n` : ''}---\n\n${body}\n`;
}

export function cli(home, args) {
  const result = spawnSync(binary, [...args, '--json'], {
    cwd: home, env: { ...process.env, AGBOARD_HOME: home, TZ: 'UTC' }, encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`${args[0]} failed: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

export function seed(home, text) {
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
  run('history', 'add', '3', '--reason', text.workNote);
  run('state', '3', 'pending', '--actor', 'ai', '--no-wait', '--request-json', JSON.stringify({
    question: text.question, choices: text.choices.map((label, i) => ({ id: `option-${i + 1}`, label })),
  }));
  // This is a disposable human-owned sample; AI card #6 completes automatically at server startup.
  run('mv', '8', 'done', '--actor', 'human', '--reason', 'Sample mobile review completed');
  const plan = (priority) => `---\npriority: ${JSON.stringify(priority)}\n---\n\n${text.plan}\n\n## ${text === copy.ja ? '参考条件' : 'Reference conditions'}\n\n${text.epicChecks.map((check, i) => `- [${i === 0 ? 'x' : ' '}] ${check}`).join('\n')}\n`;
  run('epic', 'edit', 'LAUNCH', '--document', plan([3, 4, 7, 5, 6]));
  run('epic', 'edit', 'DESIGN', '--document', plan([1, 2, 8]));
  return meta.id;
}

export async function freePort(preferred = 0) {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(preferred, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Stops what `startServer` returned: the phone entrance, or any child process. */
export async function stop(server) {
  if (typeof server?.stop === 'function') return server.stop();
  if (!server || server.exitCode !== null || server.signalCode !== null) return undefined;
  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill('SIGTERM');
  return exited;
}

export async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations()
      .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
      .map((a) => a.finished.catch(() => undefined)));
  });
  await page.mouse.move(0, 0);
}

/**
 * Starts the board for the scripts: the PC board on loopback (`origin`) and the phone monitor behind
 * the ngrok entrance stand-in (`remote`), both over `home`. No connection to ngrok is made.
 */
export async function startServer(home) {
  const entrance = await startPhoneEntrance(home);
  return { server: entrance, origin: entrance.pcOrigin, remote: entrance.phoneOrigin };
}
