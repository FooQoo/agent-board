import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  agboardBinary,
  agboardCatalogOk,
  decisionJson,
  projectId,
  skipGuide,
  taskBody,
  workspace,
} from './agboard';

// The phone monitor is reached through the ngrok entrance: the dedicated loopback
// backend behind an Edge stand-in. See phone-entrance.mjs for what is and is not covered.
export { startPhoneEntrance, type PhoneEntrance } from './phone-entrance.mjs';

function run(home: string, args: string[]): string {
  const result = spawnSync(agboardBinary(), args, {
    cwd: home,
    env: { ...process.env, AGBOARD_HOME: home, TZ: 'UTC' },
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`agboard ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

function task(home: string, project: string, title: string, description: string): number {
  const value = JSON.parse(
    run(home, ['--project', project, 'add', title, '--desc', taskBody(description), '--assignee', 'ai', '--actor', 'ai', '--json']),
  ) as { task: { id: number } };
  return value.task.id;
}

function move(home: string, project: string, id: number, lane: 'doing' | 'done', reason: string): void {
  run(home, ['--project', project, 'mv', String(id), lane, '--actor', 'ai', '--reason', reason]);
}

function state(home: string, project: string, id: number, status: 'running' | 'pending', reason: string): void {
  const args = status === 'pending' ? ['--no-wait', '--request-json', decisionJson(reason)] : ['--reason', reason];
  run(home, ['--project', project, 'state', String(id), status, '--actor', 'ai', ...args]);
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** Build an isolated two-project file-store fixture using the real CLI and the documented shared files. */
export function createMonitorHome(): string {
  const home = mkdtempSync(path.join(os.tmpdir(), 'agent-board-monitor-'));
  skipGuide(home);
  for (const name of ['Alpha', 'Beta', 'Empty', 'DeleteMe']) agboardCatalogOk(['project', 'create', name], home);

  const alphaPending = task(home, 'Alpha', 'Alpha pending review', 'Pending request body.');
  move(home, 'Alpha', alphaPending, 'doing', 'Start review');
  state(home, 'Alpha', alphaPending, 'pending', 'Waiting for the user review.');
  const alphaRunning = [
    task(home, 'Alpha', 'Alpha running one', 'Running task one.'),
    task(home, 'Alpha', 'Alpha running two', 'Running task two.'),
  ];
  for (const id of alphaRunning) {
    move(home, 'Alpha', id, 'doing', 'Start work');
    state(home, 'Alpha', id, 'running', 'Working now');
  }
  const firstCompleted = task(home, 'Alpha', 'Alpha completed 1', 'Completed detail 1.');
  move(home, 'Alpha', firstCompleted, 'doing', 'Start work');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==',
    'base64',
  );
  const image = path.join(home, 'monitor.png');
  writeFileSync(image, png);
  const attachment = JSON.parse(
    run(home, ['--project', 'Alpha', 'attachment', 'add', '4', '--file', image, '--actor', 'ai', '--json']),
  ) as { attachment: { id: string } };
  run(home, [
    '--project', 'Alpha', 'edit', '4', '--desc', taskBody(
      `A shared read-only detail with an owned image and Mermaid diagram.\n\n![monitor.png](attachment:${attachment.attachment.id})\n\n\`\`\`mermaid\ngraph TD\n  A[Monitor] --> B[Shared files]\n\`\`\``,
    ), '--json',
  ]);
  move(home, 'Alpha', firstCompleted, 'done', 'Complete work');
  for (let index = 1; index < 8; index++) {
    const id = task(home, 'Alpha', `Alpha completed ${index + 1}`, `Completed detail ${index + 1}.`);
    move(home, 'Alpha', id, 'doing', 'Start work');
    move(home, 'Alpha', id, 'done', 'Complete work');
  }
  const draftId = task(home, 'Alpha', 'Alpha draft task', 'Draft content that must remain visible.');
  const alphaFolder = workspace('Alpha', home).folder;
  const draftPath = path.join(alphaFolder, 'tasks', String(draftId), 'task.json');
  const draft = JSON.parse(readFileSync(draftPath, 'utf8')) as Record<string, unknown>;
  writeJson(draftPath, { ...draft, isDraft: true });

  // Keep both draft and ordinary Todo cards, and an idle card already in Doing,
  // so the view proves its columns come from taskStatus rather than agentStatus.
  task(home, 'Alpha', 'Alpha ordinary todo', 'An ordinary task that has not started.');
  const idleDoing = task(home, 'Alpha', 'Alpha idle doing', 'A doing task with no active agent status.');
  move(home, 'Alpha', idleDoing, 'doing', 'Put the idle task in Doing');

  const betaPending = task(home, 'Beta', 'Beta pending review', 'Same-number project task.');
  move(home, 'Beta', betaPending, 'doing', 'Start review');
  state(home, 'Beta', betaPending, 'pending', 'Waiting for Beta input.');
  for (const [index, status] of (['running', 'done'] as const).entries()) {
    const id = task(home, 'Beta', `Beta ${status} #${index + 2}`, `Beta detail ${status}.`);
    move(home, 'Beta', id, 'doing', 'Start work');
    if (status === 'running') state(home, 'Beta', id, 'running', 'Working on Beta');
    else move(home, 'Beta', id, 'done', 'Complete Beta');
  }
  return home;
}

export function removeMonitorHome(home: string): void {
  rmSync(home, { recursive: true, force: true });
}

export function monitorProjectId(home: string, name: string): string {
  return projectId(name, home);
}
