import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The repository root (the parent of e2e/). */
export const repoRoot = path.resolve(here, '..', '..');
export const seedFile = path.resolve(here, '..', 'fixtures', 'agent-board.json');
const ptyAnswer = path.resolve(here, 'agboard_pty_answer.py');

export const mainPort = 7631;
export const statesPort = 7632;

export function agboardBinary(): string {
  return path.join(repoRoot, 'target', 'debug', 'agboard');
}

/** The data directory shared by the main serve and the CLI helper. */
export function mainHome(): string {
  const home = process.env.SKAN_E2E_HOME;
  if (!home) throw new Error('SKAN_E2E_HOME is not set; global setup did not run');
  return home;
}

export function makeHome(label: string): string {
  return mkdtempSync(path.join(os.tmpdir(), `agent-board-e2e-${label}-`));
}

export function removeHome(home: string): void {
  rmSync(home, { recursive: true, force: true });
}

function agboardEnv(home: string): NodeJS.ProcessEnv {
  return { ...process.env, SKAN_HOME: home, TZ: 'UTC' };
}

export interface AgboardResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run `agboard <args>` against `home` (the main home by default), without a terminal. */
export function agboard(args: string[], home: string = mainHome()): AgboardResult {
  const result = spawnSync(agboardBinary(), withTestDefaults(args, home), {
    env: agboardEnv(home),
    cwd: home,
    encoding: 'utf8',
    input: '',
  });
  if (result.error) throw result.error;
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

/** Like `agboard`, but the command must succeed. */
export function agboardOk(args: string[], home: string = mainHome()): AgboardResult {
  const result = agboard(args, home);
  if (result.code !== 0) {
    throw new Error(`agboard ${args.join(' ')} exited ${result.code}: ${result.stderr}`);
  }
  return result;
}

export interface CardJson {
  id: number;
  title: string;
  cardStatus: 'todo' | 'doing' | 'done';
  assignee: 'ai' | 'human';
  agentStatus: 'idle' | 'running' | 'pending';
  pendingReason: string | null;
  pendingRequestId: string | null;
}

/** The cards from `agboard ls --json`. */
export function listCards(home: string = mainHome()): CardJson[] {
  return JSON.parse(agboardOk(['ls', '--json'], home).stdout).cards;
}

/**
 * Answer a "[y/N] " prompt of a human-only command (`rm`, `init`, `import`) the
 * way a person at a terminal would. Runs `agboard` on a pseudo-terminal through
 * a small Python helper, because Node cannot allocate one.
 */
export function agboardOnTerminal(
  answer: string,
  args: string[],
  home: string = mainHome(),
): AgboardResult {
  const result = spawnSync('python3', [ptyAnswer, answer, agboardBinary(), ...args], {
    env: agboardEnv(home),
    cwd: home,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Put the board of `home` back to the version-two Agent Board fixture.
 *
 * This only clears the temporary test directory and imports the version-two fixture.
 * The running serve opens the database per request and notices nothing.
 */
export function resetBoard(home: string = mainHome()): void {
  for (const name of ['board.db', 'board.db-wal', 'board.db-shm']) {
    rmSync(path.join(home, name), { force: true });
  }
  agboardOk(['import', seedFile], home);
}

function withTestDefaults(args: string[], home: string): string[] {
  const result = [...args];
  const command = result[0];
  if (command === 'add' && !result.includes('--assignee')) result.push('--assignee', 'ai', '--actor', 'ai');
  if ((command === 'mv' || command === 'state') && !result.includes('--actor')) {
    result.push('--actor', 'human');
    if (!result.includes('--reason') && !result.includes('--reason-file')) result.push('--reason', 'E2E user action');
  }
  if (command === 'state' && result[2] === 'idle' && !result.includes('--request')) {
    const snapshot = spawnSync(agboardBinary(), ['snapshot', '--json'], { env: agboardEnv(home), encoding: 'utf8' });
    if (snapshot.status === 0) {
      const card = (JSON.parse(snapshot.stdout).cards as CardJson[]).find((item) => item.id === Number(result[1]));
      if (card?.agentStatus === 'pending' && card.pendingRequestId) result.push('--request', card.pendingRequestId);
    }
  }
  return result;
}

/** The data-directory-only setup: a board with no cards. */
export function initEmptyBoard(home: string, name: string): void {
  agboardOk(['init', '--name', name], home);
}

async function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

export interface Serve {
  process: ChildProcess;
  port: number;
  url: string;
}

async function waitForHealth(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`agboard serve exited with ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`agboard serve did not answer on port ${port}`);
}

/** Start `agboard serve --port <port>` on `home` and wait until it answers. */
export async function startServe(port: number, home: string): Promise<Serve> {
  if (!(await portIsFree(port))) throw new Error(`port ${port} is already in use`);
  const child = spawn(agboardBinary(), ['serve', '--port', String(port)], {
    env: agboardEnv(home),
    cwd: home,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr?.resume();
  await waitForHealth(port, child);
  return { process: child, port, url: `http://127.0.0.1:${port}/` };
}

/** Stop a serve this process started and wait for it to exit. */
export async function stopServe(serve: Serve | undefined): Promise<void> {
  const child = serve?.process;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await exited;
  }
}
