import { spawn, type ChildProcess } from 'node:child_process';
import { expect, test } from '../helpers/fixtures';
import {
  agboardBinary, agboardCatalogOk, agboardOk, decisionJson, makeHome, projectId, removeHome, startServe, stopServe,
  type Serve, type TaskJson,
} from '../helpers/agboard';
import { answerButton, send, openAnswer } from '../helpers/answer';
import { closeMessages } from '../helpers/answer-flow';

// Asking a pending question with no wait setting waits for the answer. This runs the real CLI as a child
// process against its own data area and serve, answers in the browser, and expects the same child to finish.

const project = 'default-wait';

function show(home: string, id: number): TaskJson & { agentStatus: string; pendingRequestId: string | null } {
  return JSON.parse(agboardOk(project, ['show', String(id), '--json'], home).stdout).task;
}

async function reap(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGKILL');
  await exited;
}

test('default pending waits for a browser answer', async ({ page }) => {
  const home = makeHome('default-wait');
  let serve: Serve | undefined;
  let waiter: ChildProcess | undefined;
  try {
    agboardCatalogOk(['project', 'create', project], home);
    agboardOk(project, ['add', 'Ask and wait', '--assignee', 'ai', '--actor', 'human'], home);
    serve = await startServe(home);

    // The request has no wait setting at all: the child must wait for the answer on its own.
    waiter = spawn(agboardBinary(), [
      '--project', project, 'message', 'ask', '--actor', 'ai', '--task', '1', '--json',
      '--questions-json', decisionJson('Which plan should the default wait use?'),
    ], { cwd: home, env: { ...process.env, AGBOARD_HOME: home, TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    waiter.stdout?.on('data', (chunk) => { stdout += chunk; });
    waiter.stderr?.on('data', (chunk) => { stderr += chunk; });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      waiter?.once('exit', (code, signal) => resolve({ code, signal }));
    });

    await page.goto(`${serve.url}?project=${projectId(project, home)}`);
    await expect(answerButton(page, 1)).toBeVisible();
    const request = await openAnswer(page, 1);
    await expect(request).toContainText('Which plan should the default wait use?');
    expect(waiter.exitCode, 'the child keeps waiting while the question is open').toBeNull();
    expect(show(home, 1)).toMatchObject({ agentStatus: 'pending' });

    await request.getByRole('radio', { name: 'Plan B' }).check();
    await send(page);

    expect(await exited, stderr).toEqual({ code: 0, signal: null });
    // The command prints one JSON event per line and ends with the answers.
    const events = stdout.trim().split('\n').map((line) => JSON.parse(line) as { type: string; answers?: { id: string; choiceId: string | null; choiceLabel: string | null; via: string }[] });
    expect(events[0]?.type).toBe('registered');
    const last = events.at(-1);
    expect(last?.type).toBe('answered');
    expect(last?.answers?.[0]).toMatchObject({ id: 'Q-1', choiceId: 'b', choiceLabel: 'Plan B', via: 'ui' });
    expect(show(home, 1)).toMatchObject({ id: 1, agentStatus: 'idle', pendingRequestId: null });
    expect(show(home, 1)).toMatchObject({ agentStatus: 'idle', pendingRequestId: null });
    await closeMessages(page);
    await expect(answerButton(page, 1)).toHaveCount(0);
  } finally {
    await reap(waiter);
    await stopServe(serve);
    removeHome(home);
  }
});
