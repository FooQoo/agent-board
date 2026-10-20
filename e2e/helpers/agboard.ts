import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The repository root (the parent of e2e/). */
export const repoRoot = path.resolve(here, '..', '..');
export const seedFile = path.resolve(here, '..', 'fixtures', 'agent-board.json');
const ptyAnswer = path.resolve(here, 'agboard_pty_answer.py');

/**
 * Backups of two projects, `Alpha` and `Beta`. Both have a card #1 and a card #2 with different content.
 * The fixtures keep the card IDs and history of the board they were taken from; `seedProject` writes them
 * into the shared folder in the current file format.
 */
export const alphaFixture = path.resolve(here, '..', 'fixtures', 'multi-project-a.json');
export const betaFixture = path.resolve(here, '..', 'fixtures', 'multi-project-b.json');

export const mainPort = Number(process.env.AGBOARD_E2E_MAIN_PORT ?? 7631);
export const statesPort = Number(process.env.AGBOARD_E2E_STATES_PORT ?? 7632);
export const mainOrigin = `http://127.0.0.1:${mainPort}`;

/** The project the main serve shows. Every helper takes the project explicitly; none has a default. */
export const mainProject = 'agent-board';

export function agboardBinary(): string {
  return process.env.AGBOARD_E2E_BINARY ?? path.join(repoRoot, 'target', 'debug', 'agboard');
}

/** The data directory shared by the main serve and the CLI helper. */
export function mainHome(): string {
  const home = process.env.AGBOARD_E2E_HOME;
  if (!home) throw new Error('AGBOARD_E2E_HOME is not set; global setup did not run');
  return home;
}

export function makeHome(label: string): string {
  return mkdtempSync(path.join(os.tmpdir(), `agent-board-e2e-${label}-`));
}

export function removeHome(home: string): void {
  rmSync(home, { recursive: true, force: true });
}

function agboardEnv(home: string): NodeJS.ProcessEnv {
  return { ...process.env, AGBOARD_HOME: home, TZ: 'UTC' };
}

export interface AgboardResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a project command, `agboard --project <project> <args>`, against `home` (the main home by default),
 * without a terminal. The project is always named by the caller.
 */
export function agboard(project: string, args: string[], home: string = mainHome()): AgboardResult {
  return run(['--project', project, ...withTestDefaults(project, args, home)], home);
}

/** Run a whole-catalog command such as `project create NAME` or `project ls`, which takes no `--project`. */
export function agboardCatalog(args: string[], home: string = mainHome()): AgboardResult {
  return run(withOwnFolder(args, home), home);
}

/**
 * `project create` binds the folder it runs in, and one folder belongs to one project. A helper that
 * creates several projects in one data area gives each its own folder inside that area.
 */
function withOwnFolder(args: string[], home: string): string[] {
  const at = args.findIndex((arg, index) => arg === 'project' && args[index + 1] === 'create');
  const name = args[at + 2];
  if (at < 0 || name === undefined || name.startsWith('-') || args.includes('--folder')) return args;
  const folder = mkdtempSync(path.join(home, 'folder-'));
  return [...args.slice(0, at + 3), '--folder', folder, ...args.slice(at + 3)];
}

function run(args: string[], home: string): AgboardResult {
  const result = spawnSync(agboardBinary(), args, {
    env: agboardEnv(home),
    cwd: home,
    encoding: 'utf8',
    input: '',
  });
  if (result.error) throw result.error;
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

/** Like `agboard`, but the command must succeed. */
export function agboardOk(project: string, args: string[], home: string = mainHome()): AgboardResult {
  const result = agboard(project, args, home);
  if (result.code !== 0) {
    throw new Error(`agboard --project ${project} ${args.join(' ')} exited ${result.code}: ${result.stderr}`);
  }
  return result;
}

/** Like `agboardCatalog`, but the command must succeed. */
export function agboardCatalogOk(args: string[], home: string = mainHome()): AgboardResult {
  const result = agboardCatalog(args, home);
  if (result.code !== 0) throw new Error(`agboard ${args.join(' ')} exited ${result.code}: ${result.stderr}`);
  return result;
}

export interface ProjectJson {
  id: string;
  name: string;
  createdAt: string;
}

/** The projects from `agboard project ls --json`. */
export function listProjects(home: string = mainHome()): ProjectJson[] {
  return JSON.parse(agboardCatalogOk(['project', 'ls', '--json'], home).stdout).projects;
}

/** The immutable ID of the project called `name`. */
export function projectId(name: string, home: string = mainHome()): string {
  const found = listProjects(home).find((project) => project.name === name);
  if (!found) throw new Error(`project "${name}" does not exist`);
  return found.id;
}

export interface WorkspaceJson {
  projectId: string;
  folder: string;
  readme: string;
  tasks: string;
  epics: string;
}

/** The shared folder of `project`, from `agboard workspace --json`. */
export function workspace(project: string, home: string = mainHome()): WorkspaceJson {
  return JSON.parse(agboardOk(project, ['workspace', '--json'], home).stdout);
}

export interface TaskJson {
  id: number;
  title: string;
  taskStatus: 'todo' | 'doing' | 'done';
  taskStatusChangedAt: string;
  assignee: 'ai' | 'human';
  agentStatus: 'idle' | 'running' | 'pending';
  pendingReason: string | null;
  pendingRequestId: string | null;
  pendingChoices?: { id: string; label: string }[];
}

/** The cards of `project` from `agboard ls --json`. */
export function listTasks(project: string, home: string = mainHome()): TaskJson[] {
  return JSON.parse(agboardOk(project, ['ls', '--json'], home).stdout).tasks;
}

/**
 * The ID the next card of `project` will get, read from the project's `project.json`. Card IDs are never
 * reused, so specs that create cards read this after the reset instead of assuming a number.
 */
export function nextTaskId(project: string, home: string = mainHome()): number {
  const file = path.join(workspace(project, home).folder, 'project.json');
  return (JSON.parse(readFileSync(file, 'utf8')) as { nextTaskId: number }).nextTaskId;
}

/**
 * The body a spec writes to a card. The CLI reads any Markdown as the body, so the text is passed as given,
 * with surrounding blank lines removed.
 */
export function taskBody(text: string): string {
  return text.trim();
}

/** Write a file the way the README asks people to: a temporary file in the same folder, renamed over the target. */
export function replaceFileAtomically(file: string, content: string): void {
  const temp = path.join(path.dirname(file), `.tmp-${randomBytes(6).toString('hex')}`);
  writeFileSync(temp, content, 'utf8');
  renameSync(temp, file);
}

/** Replace only the Markdown body of a task, keeping its TASK.md frontmatter (including history). */
export function replaceTaskBodyPreservingFrontmatter(file: string, body: string): void {
  const current = readFileSync(file, 'utf8');
  const match = current.match(/^---\n([\s\S]*?)\n---\n(?:\n)?[\s\S]*$/);
  if (!match) throw new Error(`${file} has no valid frontmatter to preserve`);
  replaceFileAtomically(file, `---\n${match[1]}\n---\n\n${taskBody(body)}\n`);
}

function writeJson(file: string, value: unknown): void {
  replaceFileAtomically(file, `${JSON.stringify(value, null, 2)}\n`);
}

function yamlScalar(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw new Error(`Unsupported history value: ${JSON.stringify(value)}`);
}

function historyFrontmatter(events: Record<string, unknown>[]): string {
  const lines = ['history:'];
  for (const event of events) {
    let first = true;
    for (const [key, value] of Object.entries(event)) {
      if (key === 'choices' && Array.isArray(value)) {
        if (value.length === 0) {
          lines.push(`${first ? '  - ' : '    '}choices: []`);
        } else {
          lines.push(`${first ? '  - ' : '    '}choices:`);
          for (const choice of value) {
            const item = choice as Record<string, unknown>;
            lines.push(`      - id: ${yamlScalar(item.id)}`);
            lines.push(`        label: ${yamlScalar(item.label)}`);
          }
        }
      } else {
        lines.push(`${first ? '  - ' : '    '}${key}: ${yamlScalar(value)}`);
      }
      first = false;
    }
  }
  return lines.join('\n');
}

function taskMarkdown(description: string, events: Record<string, unknown>[]): string {
  const text = taskBody(description);
  const frontmatter = historyFrontmatter(events);
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return `---\n${frontmatter}\n---\n\n${text}`;
  const yaml = match[1].trimEnd();
  const body = match[2].replace(/^\n/, '');
  return `---\n${yaml}\n${frontmatter}\n---\n\n${body}`;
}

interface FixtureEvent { at: string; reason: string; }

interface FixtureTask {
  id: number;
  title: string;
  description: string;
  position: number;
  assignee: 'ai' | 'human';
  taskStatus: 'todo' | 'doing' | 'done';
  taskStatusChangedAt: string;
  agentStatus: 'idle' | 'running' | 'pending';
  pendingReason: string | null;
  pendingRequestId: string | null;
  pendingChoices?: { id: string; label: string }[];
  createdAt: string;
  updatedAt: string;
  agentStatusChangedAt: string;
  history: FixtureEvent[];
}

interface Fixture {
  board: { name: string; createdAt: string; nextTaskId: number };
  tasks: FixtureTask[];
}

/** The task.json and TASK.md of one fixture card, in the current file format. */
function taskFilesFor(item: FixtureTask): { task: Record<string, unknown>; markdown: string } {
  const history = item.history.map(({ at, reason }) => ({ at, reason }));
  const taskJson = {
    formatVersion: 1,
    id: item.id,
    title: item.title,
    assignee: item.assignee,
    epicId: null,
    taskStatus: item.taskStatus,
    taskStatusChangedAt: item.taskStatusChangedAt,
    agentStatus: item.agentStatus,
    position: item.position,
    isDraft: false,
    archivedAt: null,
    pendingRequestId: item.agentStatus === 'pending' ? item.pendingRequestId : null,
    pendingRequest: item.agentStatus === 'pending' ? { question: item.pendingReason ?? '', choices: item.pendingChoices ?? [] } : null,
    requestAnswers: [],
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    agentStatusChangedAt: item.agentStatusChangedAt,
    attachments: [],
  };
  return { task: taskJson, markdown: taskMarkdown(item.description, history) };
}

/**
 * Write the cards of a fixture into `project`'s shared folder, replacing its tasks and epics and keeping the
 * project's identity. The project must already exist. The files are written directly, as a person would
 * edit TASK.md, and the CLI reads them back on the next command.
 */
export function seedProject(project: string, file: string, home: string = mainHome()): void {
  const folder = workspace(project, home).folder;
  rmSync(path.join(folder, 'tasks'), { recursive: true, force: true });
  rmSync(path.join(folder, 'epics'), { recursive: true, force: true });
  const fixture = JSON.parse(readFileSync(file, 'utf8')) as Fixture;
  for (const item of fixture.tasks) {
    const dir = path.join(folder, 'tasks', String(item.id));
    mkdirSync(dir, { recursive: true });
    const { task, markdown } = taskFilesFor(item);
    writeJson(path.join(dir, 'task.json'), task);
    replaceFileAtomically(path.join(dir, 'TASK.md'), markdown);
    // The screen shows the newer of task.json's updatedAt and TASK.md's modification time, so both files
    // carry the fixture's time and the seeded cards keep the times the specs expect.
    const at = new Date(item.updatedAt);
    utimesSync(path.join(dir, 'task.json'), at, at);
    utimesSync(path.join(dir, 'TASK.md'), at, at);
  }
  const projectFile = path.join(folder, 'project.json');
  const current = JSON.parse(readFileSync(projectFile, 'utf8')) as Record<string, unknown>;
  writeJson(projectFile, { ...current, nextTaskId: fixture.board.nextTaskId });
}

/** Create `project` if it does not exist yet. */
export function ensureProject(project: string, home: string = mainHome()): void {
  if (!listProjects(home).some((existing) => existing.name === project)) {
    agboardCatalogOk(['project', 'create', project], home);
  }
}

/**
 * Answer a "[y/N] " prompt of a human-only command (`rm`, `project rm`) the way a person at a terminal
 * would. Runs `agboard` on a pseudo-terminal through a small Python helper, because Node cannot allocate one.
 */
export function agboardOnTerminal(
  project: string,
  answer: string,
  args: string[],
  home: string = mainHome(),
): AgboardResult {
  const result = spawnSync('python3', [ptyAnswer, answer, agboardBinary(), '--project', project, ...args], {
    env: agboardEnv(home),
    cwd: home,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Put `project` back to the version-two Agent Board fixture. The project keeps its ID; its tasks and epics are
 * replaced by the fixture's cards.
 */
export function resetBoard(project: string, home: string = mainHome()): void {
  restoreProject(project, seedFile, home);
}

/**
 * Put `project` back to the fixture in `file`. A project that does not exist is created first; an existing
 * one keeps its ID and gets the fixture's cards.
 */
export function restoreProject(project: string, file: string, home: string = mainHome()): void {
  ensureProject(project, home);
  seedProject(project, file, home);
}

/** Delete `project` and its cards the way a person does: with a `y` on a terminal. */
export function removeProject(project: string, home: string = mainHome()): void {
  const result = agboardOnTerminal(project, 'y', ['project', 'rm'], home);
  if (result.code !== 0) throw new Error(`deleting ${project} failed: ${result.stdout}${result.stderr}`);
}

/** Leave exactly `Alpha` and `Beta` in `home`, each restored from its backup. */
export function resetAlphaBeta(home: string): void {
  for (const project of listProjects(home)) {
    if (project.name !== 'Alpha' && project.name !== 'Beta') removeProject(project.name, home);
  }
  restoreProject('Alpha', alphaFixture, home);
  restoreProject('Beta', betaFixture, home);
}

function withTestDefaults(project: string, args: string[], home: string): string[] {
  const result = [...args];
  const command = result[0];
  if (command === 'add' && !result.includes('--assignee')) result.push('--assignee', 'ai', '--actor', 'ai');
  if ((command === 'mv' || command === 'state') && !result.includes('--actor')) {
    result.push('--actor', 'human');
  }
  if (command === 'state' && result[2] === 'idle' && !result.includes('--request')) {
    const snapshot = spawnSync(agboardBinary(), ['--project', project, 'snapshot', '--json'], { env: agboardEnv(home), encoding: 'utf8' });
    if (snapshot.status === 0) {
      const task = (JSON.parse(snapshot.stdout).tasks as TaskJson[]).find((item) => item.id === Number(result[1]));
      if (task?.agentStatus === 'pending' && task.pendingRequestId) {
        result.push('--request', task.pendingRequestId);
        if (!result.includes('--reason') && !result.includes('--reason-file')) result.push('--reason', 'User confirmed the current request.');
      }
    }
  }
  return result;
}

/** A project with no cards. */
export function createEmptyProject(home: string, name: string): void {
  agboardCatalogOk(['project', 'create', name], home);
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

/** A decision request for `state ... pending --request-json`: the question and two choices. */
export function decisionJson(question: string): string {
  return JSON.stringify({
    question,
    choices: [
      { id: 'a', label: 'Plan A' },
      { id: 'b', label: 'Plan B' },
    ],
  });
}
