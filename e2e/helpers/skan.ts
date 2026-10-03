import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The repository root (the parent of e2e/). */
export const repoRoot = path.resolve(here, '..', '..');
export const seedFile = path.resolve(here, '..', 'fixtures', 'seed.skan.json');
const ptyAnswer = path.resolve(here, 'pty_answer.py');

export const mainPort = 7631;
export const statesPort = 7632;

export function skanBinary(): string {
  return path.join(repoRoot, 'target', 'debug', 'skan');
}

/** The data directory shared by the main serve and the CLI helper. */
export function mainHome(): string {
  const home = process.env.SKAN_E2E_HOME;
  if (!home) throw new Error('SKAN_E2E_HOME is not set; global setup did not run');
  return home;
}

export function makeHome(label: string): string {
  return mkdtempSync(path.join(os.tmpdir(), `skan-e2e-${label}-`));
}

export function removeHome(home: string): void {
  rmSync(home, { recursive: true, force: true });
}

function skanEnv(home: string): NodeJS.ProcessEnv {
  return { ...process.env, SKAN_HOME: home, TZ: 'UTC' };
}

export interface SkanResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run `skan <args>` against `home` (the main home by default), without a terminal. */
export function skan(args: string[], home: string = mainHome()): SkanResult {
  const result = spawnSync(skanBinary(), args, {
    env: skanEnv(home),
    cwd: home,
    encoding: 'utf8',
    input: '',
  });
  if (result.error) throw result.error;
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

/** Like `skan`, but the command must succeed. */
export function skanOk(args: string[], home: string = mainHome()): SkanResult {
  const result = skan(args, home);
  if (result.code !== 0) {
    throw new Error(`skan ${args.join(' ')} exited ${result.code}: ${result.stderr}`);
  }
  return result;
}

export interface CardJson {
  id: number;
  title: string;
  column: 'todo' | 'doing' | 'done';
  run_state: 'idle' | 'running' | 'pending';
  pending_reason: string | null;
}

/** The cards from `skan ls --json`. */
export function listCards(home: string = mainHome()): CardJson[] {
  return JSON.parse(skanOk(['ls', '--json'], home).stdout).cards;
}

/**
 * Answer a "[y/N] " prompt of a human-only command (`rm`, `init`, `import`) the
 * way a person at a terminal would. Runs `skan` on a pseudo-terminal through
 * a small Python helper, because Node cannot allocate one.
 */
export function skanOnTerminal(
  answer: string,
  args: string[],
  home: string = mainHome(),
): SkanResult {
  const result = spawnSync('python3', [ptyAnswer, answer, skanBinary(), ...args], {
    env: skanEnv(home),
    cwd: home,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Put the board of `home` back to the seed: the eight cards of the approved
 * mock with fixed timestamps (IDs 8 to 16, the next ID is 17).
 *
 * `skan` cannot empty a board without a human at a terminal, so the files of
 * the temporary data directory are removed and the seed is imported again.
 * The running serve opens the database per request and notices nothing.
 */
export function resetBoard(home: string = mainHome()): void {
  for (const name of ['board.db', 'board.db-wal', 'board.db-shm']) {
    rmSync(path.join(home, name), { force: true });
  }
  skanOk(['import', seedFile], home);
}

/** The data-directory-only setup: a board with no cards. */
export function initEmptyBoard(home: string, name: string): void {
  skanOk(['init', '--name', name], home);
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
    if (child.exitCode !== null) throw new Error(`skan serve exited with ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`skan serve did not answer on port ${port}`);
}

/** Start `skan serve --port <port>` on `home` and wait until it answers. */
export async function startServe(port: number, home: string): Promise<Serve> {
  if (!(await portIsFree(port))) throw new Error(`port ${port} is already in use`);
  const child = spawn(skanBinary(), ['serve', '--port', String(port)], {
    env: skanEnv(home),
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
