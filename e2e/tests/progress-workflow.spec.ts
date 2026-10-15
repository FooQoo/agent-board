import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  agboardBinary,
  agboardCatalogOk,
  agboardOk,
  makeHome,
  removeHome,
  replaceFileAtomically,
  startServe,
  stopServe,
  workspace,
} from '../helpers/agboard';

function run(args: string[], home: string, cwd: string, input = ''): { code: number; stdout: string; stderr: string } {
  const result = spawnSync(agboardBinary(), args, {
    cwd,
    env: { ...process.env, AGBOARD_HOME: home, TZ: 'UTC' },
    encoding: 'utf8',
    input,
  });
  if (result.error) throw result.error;
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

function startWaiter(home: string, cwd: string, project: string, id: number): ChildProcess {
  const child = spawn(agboardBinary(), [
    '--project', project,
    'state', String(id), 'pending', '--actor', 'ai',
    '--request-json', JSON.stringify({
      question: 'Which release plan should we use?',
      choices: [{ id: 'a', label: 'Plan A' }, { id: 'b', label: 'Plan B' }],
      wait: {},
    }),
  ], {
    cwd,
    env: { ...process.env, AGBOARD_HOME: home, TZ: 'UTC' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return child;
}

function waiterResult(child: ChildProcess): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('project setup, progress hook, indefinite question, auto-Done, and AI write guard work together', async ({ page }, testInfo) => {
  const home = makeHome('progress-workflow');
  const projectFolder = path.join(home, 'project-root');
  const nested = path.join(projectFolder, 'nested');
  const work = path.join(nested, 'work');
  mkdirSync(work, { recursive: true });
  let serve: Awaited<ReturnType<typeof startServe>> | undefined;
  let waiter: ChildProcess | undefined;
  try {
    agboardCatalogOk(['project', 'create', 'Workflow E2E', '--folder', projectFolder], home);
    agboardCatalogOk(['project', 'bind', 'Workflow E2E', '--folder', nested], home);
    const project = 'Workflow E2E';
    const projectId = JSON.parse(agboardCatalogOk(['project', 'ls', '--json'], home).stdout)
      .projects.find((item: { name: string }) => item.name === 'Workflow E2E').id as string;

    const projectArgs = (args: string[]) => ['--project', project, ...args];
    agboardOk(project, ['epic', 'add', 'RELEASE', '--name', 'Release work', '--actor', 'human'], home);
    agboardOk(project, ['add', 'Publish release', '--epic', 'RELEASE', '--assignee', 'ai', '--actor', 'ai', '--desc', 'Private task body for progress omission check.'], home);
    agboardOk(project, ['add', 'Prepare release notes', '--epic', 'RELEASE', '--assignee', 'ai', '--actor', 'ai', '--desc', 'Another private task body.'], home);
    const cards = JSON.parse(agboardOk(project, ['ls', '--json'], home).stdout).cards as Array<{ id: number; title: string }>;
    const publish = cards.find((card) => card.title === 'Publish release')!.id;
    const notes = cards.find((card) => card.title === 'Prepare release notes')!.id;
    agboardOk(project, ['epic', 'edit', 'RELEASE', '--priority', `${notes},${publish}`], home);

    const progress = run(['progress', '--json'], home, work);
    expect(progress.code, progress.stderr).toBe(0);
    const progressJson = JSON.parse(progress.stdout);
    expect(progressJson.epics[0].cards.map((card: { id: number }) => card.id)).toEqual([notes, publish]);
    expect(JSON.stringify(progressJson)).not.toContain('Private task body');

    const hook = run(['hook', '--agent', 'codex', '--json'], home, work, JSON.stringify({
      hook_event_name: 'SessionStart',
      cwd: work,
    }));
    expect(hook.code, hook.stderr).toBe(0);
    const hookOutput = JSON.parse(hook.stdout).hookSpecificOutput.additionalContext as string;
    expect(hookOutput).toContain('AGBOARD_PROGRESS\n');
    expect(hookOutput).toContain('Workflow E2E');
    const unregistered = run(['progress', '--json'], home, home);
    expect(unregistered.code).not.toBe(0);
    expect(unregistered.stderr).toContain('folder_unbound');

    const taskFile = path.join(workspace(project, home).folder, 'tasks', String(publish), 'TASK.md');
    const taskBeforeAcceptance = readFileSync(taskFile, 'utf8');
    const taskWithAcceptance = taskBeforeAcceptance
      .replace(/^---\n/, '---\nacceptance:\n  - id: AC-1\n    text: Release plan confirmed\n    done: false\n')
      .replace('Private task body for progress omission check.', 'Publish the approved release.');
    replaceFileAtomically(taskFile, taskWithAcceptance);
    agboardOk(project, ['mv', String(publish), 'doing', '--actor', 'ai', '--reason', 'Preparing release'], home);
    serve = await startServe(Number(process.env.AGBOARD_E2E_PROGRESS_PORT ?? 8362), home);
    waiter = startWaiter(home, work, project, publish);
    const waitResult = waiterResult(waiter);
    await expect.poll(async () => {
      if (waiter!.exitCode !== null) {
        const result = await waitResult;
        throw new Error(`wait command exited ${result.code}: ${result.stderr}${result.stdout}`);
      }
      return JSON.parse(agboardOk(project, ['show', String(publish), '--json'], home).stdout).card.agentStatus;
    }).toBe('pending');

    // Completing the condition cannot auto-Done a card while it is waiting for a human answer.
    const taskWhilePending = readFileSync(taskFile, 'utf8');
    replaceFileAtomically(taskFile, taskWhilePending.replace('done: false', 'done: true'));
    expect((await page.request.post(new URL('/api/notify', serve.url).toString())).status()).toBe(204);
    expect(JSON.parse(agboardOk(project, ['show', String(publish), '--json'], home).stdout).card.acceptance)
      .toEqual([{ id: 'AC-1', text: 'Release plan confirmed', done: true }]);
    expect(JSON.parse(agboardOk(project, ['show', String(publish), '--json'], home).stdout).card)
      .toMatchObject({ cardStatus: 'doing', agentStatus: 'pending' });

    await page.goto(`${serve.url}?project=${projectId}`);
    const cardButton = page.getByRole('button', { name: new RegExp(`^#${publish}(?!\\d)`) });
    await expect(cardButton).toBeVisible();
    await cardButton.click();
    const answer = page.locator(`.card__answer[data-card-id="${publish}"]`)
      .getByRole('region', { name: 'The agent is waiting for your answer' });
    await expect(answer).toContainText('Which release plan should we use?');
    await page.screenshot({ path: testInfo.outputPath('pending-release-question.png') });
    await answer.getByRole('textbox', { name: 'Your answer' }).fill('Choose Plan A and publish after review.');
    await answer.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(answer).toHaveCount(0);

    const completed = await waitResult;
    expect(completed.code, completed.stderr).toBe(0);
    expect(completed.stdout).toContain('Choose Plan A and publish after review.');
    await expect.poll(() => JSON.parse(agboardOk(project, ['show', String(publish), '--json'], home).stdout).card.cardStatus)
      .toBe('done');
    const shown = JSON.parse(agboardOk(project, ['show', String(publish), '--json'], home).stdout).card;
    expect(shown).toMatchObject({ cardStatus: 'done', agentStatus: 'idle', pendingRequestId: null });
    expect(shown.acceptance).toEqual([{ id: 'AC-1', text: 'Release plan confirmed', done: true }]);

    const rejected = run(projectArgs(['edit', String(publish), '--title', 'AI changed Done']), home, work);
    expect(rejected.code).not.toBe(0);
    expect(rejected.stderr).toContain(`card #${publish} is done and read-only for agents`);
    expect(JSON.parse(agboardOk(project, ['show', String(publish), '--json'], home).stdout).card.title)
      .toBe('Publish release');
  } finally {
    if (waiter && waiter.exitCode === null && waiter.signalCode === null) waiter.kill('SIGTERM');
    await stopServe(serve);
    removeHome(home);
  }
});
