import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { expect, test } from '@playwright/test';
import {
  agboardBinary, agboardCatalogOk, agboardOk, decisionJson, makeHome, projectId, removeHome, startServe, stopServe,
  type Serve, type TaskJson,
} from '../helpers/agboard';

// Asking a pending question with no wait setting waits for the answer. This runs the real CLI as a child
// process against its own data area and serve, answers in the browser, and expects the same child to finish.

const project = 'default-wait';

function show(home: string, id: number): TaskJson & { agentStatus: string; pendingRequestId: string | null } {
  return JSON.parse(agboardOk(project, ['show', String(id), '--json'], home).stdout).task;
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
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
    agboardOk(project, ['add', 'Ask and wait', '--assignee', 'ai', '--actor', 'ai'], home);
    serve = await startServe(await freePort(), home);

    // The request has no wait setting at all: the child must wait for the answer on its own.
    waiter = spawn(agboardBinary(), [
      '--project', project, 'state', '1', 'pending', '--actor', 'ai', '--json',
      '--request-json', decisionJson('Which plan should the default wait use?'),
    ], { cwd: home, env: { ...process.env, AGBOARD_HOME: home, TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    waiter.stdout?.on('data', (chunk) => { stdout += chunk; });
    waiter.stderr?.on('data', (chunk) => { stderr += chunk; });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      waiter?.once('exit', (code, signal) => resolve({ code, signal }));
    });

    await page.goto(`${serve.url}?project=${projectId(project, home)}`);
    const request = page
      .locator('.card__answer[data-task-id="1"]')
      .getByRole('region', { name: 'The agent is waiting for your answer' });
    await expect(request).toContainText('Which plan should the default wait use?');
    expect(waiter.exitCode, 'the child keeps waiting while the question is open').toBeNull();
    expect(show(home, 1)).toMatchObject({ agentStatus: 'pending' });

    await request.getByRole('radio', { name: 'Plan B' }).check();
    await request.getByRole('button', { name: 'Send', exact: true }).click();

    expect(await exited, stderr).toEqual({ code: 0, signal: null });
    const output = JSON.parse(stdout) as { task: TaskJson; answer: { actor: string; choiceId: string | null; choiceLabel: string | null } };
    expect(output.answer).toMatchObject({ actor: 'human', choiceId: 'b', choiceLabel: 'Plan B' });
    expect(output.task).toMatchObject({ id: 1, agentStatus: 'idle', pendingRequestId: null });
    expect(show(home, 1)).toMatchObject({ agentStatus: 'idle', pendingRequestId: null });
    await expect(request).toHaveCount(0);
  } finally {
    await reap(waiter);
    await stopServe(serve);
    removeHome(home);
  }
});
