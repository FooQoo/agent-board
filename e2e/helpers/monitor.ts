import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { agboardBinary, agboardCatalogOk, projectId, taskBody, workspace } from './agboard';

export const monitorPort = 8060;
export const remotePort = 8061;
export const monitorOrigin = `http://127.0.0.1:${remotePort}`;
export const remoteOrigin = `http://127.0.0.1:${remotePort}`;

export interface MonitorServe {
  process: ChildProcess;
}

function run(home: string, args: string[]): string {
  const result = spawnSync(agboardBinary(), args, {
    cwd: home,
    env: { ...process.env, AGBOARD_HOME: home, TZ: 'UTC' },
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`agboard ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

function card(home: string, project: string, title: string, description: string): number {
  const value = JSON.parse(
    run(home, ['--project', project, 'add', title, '--desc', taskBody(description), '--assignee', 'ai', '--actor', 'ai', '--json']),
  ) as { card: { id: number } };
  return value.card.id;
}

function move(home: string, project: string, id: number, lane: 'doing' | 'done', reason: string): void {
  run(home, ['--project', project, 'mv', String(id), lane, '--actor', 'ai', '--reason', reason]);
}

function state(home: string, project: string, id: number, status: 'running' | 'pending', reason: string): void {
  run(home, ['--project', project, 'state', String(id), status, '--actor', 'ai', '--reason', reason]);
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** Build an isolated two-project file-store fixture using the real CLI and the documented shared files. */
export function createMonitorHome(): string {
  const home = mkdtempSync(path.join(os.tmpdir(), 'agent-board-monitor-uow7-'));
  for (const name of ['Alpha', 'Beta', 'Empty', 'DeleteMe']) agboardCatalogOk(['project', 'create', name], home);

  const alphaPending = card(home, 'Alpha', 'Alpha pending review', 'Pending request body.');
  move(home, 'Alpha', alphaPending, 'doing', 'Start review');
  state(home, 'Alpha', alphaPending, 'pending', 'Waiting for the user review.');
  const alphaRunning = [
    card(home, 'Alpha', 'Alpha running one', 'Running card one.'),
    card(home, 'Alpha', 'Alpha running two', 'Running card two.'),
  ];
  for (const id of alphaRunning) {
    move(home, 'Alpha', id, 'doing', 'Start work');
    state(home, 'Alpha', id, 'running', 'Working now');
  }
  for (let index = 0; index < 8; index++) {
    const id = card(home, 'Alpha', `Alpha completed ${index + 1}`, `Completed detail ${index + 1}.`);
    move(home, 'Alpha', id, 'doing', 'Start work');
    move(home, 'Alpha', id, 'done', 'Complete work');
  }
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==',
    'base64',
  );
  const image = path.join(home, 'monitor.png');
  const evidenceFile = path.join(home, 'run.log');
  writeFileSync(image, png);
  writeFileSync(evidenceFile, 'monitor evidence fixture\n', 'utf8');
  const attachment = JSON.parse(
    run(home, ['--project', 'Alpha', 'attachment', 'add', '4', '--file', image, '--actor', 'ai', '--json']),
  ) as { attachment: { id: string } };
  run(home, [
    '--project', 'Alpha', 'edit', '4', '--desc', taskBody(
      `A shared read-only detail with an owned image and Mermaid diagram.\n\n![monitor.png](attachment:${attachment.attachment.id})\n\n\`\`\`mermaid\ngraph TD\n  A[Monitor] --> B[Shared files]\n\`\`\``,
    ), '--json',
  ]);
  run(home, ['--project', 'Alpha', 'evidence', 'add', '4', evidenceFile, '--name', 'run.log', '--json']);
  const draftId = card(home, 'Alpha', 'Alpha draft card', 'Draft content that must remain visible.');
  const alphaFolder = workspace('Alpha', home).folder;
  const draftPath = path.join(alphaFolder, 'tasks', String(draftId), 'task.json');
  const draft = JSON.parse(readFileSync(draftPath, 'utf8')) as Record<string, unknown>;
  writeJson(draftPath, { ...draft, isDraft: true });

  const betaPending = card(home, 'Beta', 'Beta pending review', 'Same-number project card.');
  move(home, 'Beta', betaPending, 'doing', 'Start review');
  state(home, 'Beta', betaPending, 'pending', 'Waiting for Beta input.');
  for (const [index, status] of (['running', 'done'] as const).entries()) {
    const id = card(home, 'Beta', `Beta ${status} #${index + 2}`, `Beta detail ${status}.`);
    move(home, 'Beta', id, 'doing', 'Start work');
    if (status === 'running') state(home, 'Beta', id, 'running', 'Working on Beta');
    else move(home, 'Beta', id, 'done', 'Complete Beta');
  }
  return home;
}

async function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function waitForMonitor(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`agboard serve exited with ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/monitor/api/projects`);
      if (response.ok) return;
    } catch {
      // The process is still binding its listener.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`monitor API did not answer on port ${port}`);
}

async function waitForListener(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`agboard serve exited with ${child.exitCode}`);
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1', () => socket.end(() => resolve()));
        socket.once('error', reject);
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`serve listener did not answer on port ${port}`);
}

export async function startMonitorServe(home: string): Promise<MonitorServe> {
  for (const port of [monitorPort, remotePort]) {
    if (!(await portIsFree(port))) throw new Error(`port ${port} is already in use`);
  }
  const child = spawn(
    agboardBinary(),
    [
      'serve', '--port', String(monitorPort), '--remote-port', String(remotePort),
      '--remote-origin', 'https://monitor.e2e.invalid',
    ],
    {
      cwd: home,
      env: { ...process.env, AGBOARD_HOME: home, TZ: 'UTC' },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => { stderr += chunk; });
  try {
    await waitForListener(monitorPort, child);
    await waitForMonitor(remotePort, child);
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill('SIGTERM');
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
    }
    throw new Error(`${String(error)}${stderr ? `; serve stderr: ${stderr}` : ''}`);
  }
  return { process: child };
}

export async function stopMonitorServe(serve: MonitorServe | undefined): Promise<void> {
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

export function removeMonitorHome(home: string): void {
  rmSync(home, { recursive: true, force: true });
}

export function monitorProjectId(home: string, name: string): string {
  return projectId(name, home);
}

/** Add a 100-card shared-file fixture and a project/card/body at their documented length limits. */
export function addDenseMonitorFixture(home: string): string {
  const longProject = 'Project ' + 'P'.repeat(42);
  const tail = '\n\nLong body tail marker.';
  agboardCatalogOk(['project', 'create', longProject], home);
  for (let id = 13; id <= 100; id++) {
    const prefix = `Card ${id} `;
    const title = prefix + 'L'.repeat(100 - prefix.length);
    const longBodyStart = `Long body start ${id}.\n\n`;
    const bodyText = id === 100
      ? `${longBodyStart}${'x'.repeat(50_000 - taskBody(`${longBodyStart}${tail}`).length)}${tail}`
      : `Dense card ${id}.`;
    const created = card(home, 'Alpha', title, bodyText);
    if (created !== id) throw new Error(`expected dense fixture card ${id}, got ${created}`);
    move(home, 'Alpha', id, 'doing', 'Start dense fixture card');
    move(home, 'Alpha', id, 'done', 'Complete dense fixture card');
  }

  const longTitle = 'T'.repeat(100);
  const longFile = path.join(home, 'long-description.md');
  const longBodyStart = 'Long body start\n\n';
  const longText = `${longBodyStart}${'x'.repeat(50_000 - taskBody(`${longBodyStart}${tail}`).length)}${tail}`;
  writeFileSync(longFile, taskBody(longText), 'utf8');
  const added = JSON.parse(run(home, [
    '--project', longProject, 'add', longTitle, '--desc-file', longFile, '--assignee', 'ai', '--actor', 'ai', '--json',
  ])) as { card: { id: number } };
  move(home, longProject, added.card.id, 'doing', 'Start long-title fixture');
  state(home, longProject, added.card.id, 'running', 'Check long-title visibility');
  return longProject;
}
