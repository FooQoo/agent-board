import { expect, test, type Page } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {
  agboard,
  agboardBinary,
  agboardCatalogOk,
  agboardOk,
  makeHome,
  projectId,
  removeHome,
  startServe,
  stopServe,
  workspace,
  type Serve,
} from '../helpers/agboard';
import { setPreferences } from '../helpers/preferences';
import { waitForSync } from '../helpers/ui';

// Each epic keeps its details in EPIC.md. The real server leaves the files as they are, and the CLI, snapshot,
// progress, hook, wait, API, and the page all use `document` and `documentPath`. Every scenario runs on its own
// temporary data area and on a free loopback port.

test.describe.configure({ mode: 'serial' });

const PROJECT = 'Epic documents';
// A 1x1 PNG, registered as an image of the epic ALPHA.
const IMAGE_ID = 'd0eaa3a97cb774126c749c5e72006448';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const DOC_ALPHA = `---\npriority: [3, 1, 2]\n---\n\n# Alpha document\n\nAlpha text.\n\n![alpha picture](assets/${IMAGE_ID}.png)\n`;
const DOC_BETA = `---\npriority: [5, 4]\n---\n\n# Beta document\n\nBeta text.\n`;
// An epic whose document is empty.
const DOC_GAMMA = '';

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

interface Fixture {
  home: string;
  folder: string;
  alpha: string;
  beta: string;
  gamma: string;
}

/**
 * A data area with three epics (a document with a priority and an image, one with a priority, an empty one),
 * five cards spread over two epics, and one card with no epic. Built with the real CLI; the documents are then
 * written straight to each EPIC.md.
 */
function buildHome(label: string): Fixture {
  const home = makeHome(label);
  agboardCatalogOk(['project', 'create', PROJECT], home);
  const folder = workspace(PROJECT, home).folder;
  const epics = path.join(folder, 'epics');
  for (const [id, name] of [['ALPHA', 'Alpha epic'], ['BETA', 'Beta epic'], ['GAMMA', 'Gamma epic']]) {
    agboardOk(PROJECT, ['epic', 'add', id, '--name', name, '--color', '#7C3AED', '--actor', 'human'], home);
  }
  // Cards 1-3 in ALPHA, 4-5 in BETA, 6 without an epic.
  for (const [index, epic] of [['1', 'ALPHA'], ['2', 'ALPHA'], ['3', 'ALPHA'], ['4', 'BETA'], ['5', 'BETA']]) {
    agboardOk(PROJECT, ['add', `Card ${index}`, '--assignee', 'ai', '--actor', 'ai', '--epic', epic], home);
  }
  agboardOk(PROJECT, ['add', 'Card 6', '--assignee', 'ai', '--actor', 'ai'], home);

  // The image of ALPHA: the file in assets/ and its entry in epic.json.
  mkdirSync(path.join(epics, 'ALPHA', 'assets'), { recursive: true });
  writeFileSync(path.join(epics, 'ALPHA', 'assets', `${IMAGE_ID}.png`), PNG);
  const metaFile = path.join(epics, 'ALPHA', 'epic.json');
  const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
  meta.attachments = [{ id: IMAGE_ID, name: 'alpha.png', mediaType: 'image/png', size: PNG.length, createdAt: '2026-10-20T02:00:16Z' }];
  writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);

  const alpha = path.join(epics, 'ALPHA');
  const beta = path.join(epics, 'BETA');
  const gamma = path.join(epics, 'GAMMA');
  for (const [dir, text] of [[alpha, DOC_ALPHA], [beta, DOC_BETA], [gamma, DOC_GAMMA]]) {
    writeFileSync(path.join(dir, 'EPIC.md'), text);
  }
  return { home, folder, alpha, beta, gamma };
}

const json = (home: string, args: string[]) => JSON.parse(agboardOk(PROJECT, args, home).stdout);

function runWith(home: string, args: string[], input = '') {
  return spawnSync(agboardBinary(), ['--project', PROJECT, ...args], {
    env: { ...process.env, AGBOARD_HOME: home, TZ: 'UTC' },
    cwd: home,
    encoding: 'utf8',
    input,
  });
}

const dialogOf = (page: Page) => page.getByRole('dialog', { name: /Epic preview/ });

// ---------------------------------------------------------------------------------------------------------------
// One data area for the files, the contract, the page, and the restart.
// ---------------------------------------------------------------------------------------------------------------

let fixture: Fixture;
let serve: Serve | undefined;
let port = 0;
let epicJsonBefore: Record<string, string> = {};
let taskJsonBefore: Record<string, string> = {};
const read = (file: string) => readFileSync(file);

test.beforeAll(async () => {
  fixture = buildHome('epic-doc');
  port = await freePort();
  for (const id of ['ALPHA', 'BETA', 'GAMMA']) {
    epicJsonBefore[id] = readFileSync(path.join(fixture.folder, 'epics', id, 'epic.json'), 'utf8');
  }
  for (let id = 1; id <= 6; id++) {
    taskJsonBefore[id] = readFileSync(path.join(fixture.folder, 'tasks', String(id), 'task.json'), 'utf8');
  }
});

test.afterAll(async () => {
  await stopServe(serve);
  removeHome(fixture.home);
});

test('starting the server keeps every byte of each EPIC.md, the card membership, and the image', async () => {
  const before = { alpha: read(path.join(fixture.alpha, 'EPIC.md')), beta: read(path.join(fixture.beta, 'EPIC.md')) };

  serve = await startServe(port, fixture.home);

  expect(read(path.join(fixture.alpha, 'EPIC.md')).equals(before.alpha)).toBe(true);
  expect(read(path.join(fixture.beta, 'EPIC.md')).equals(before.beta)).toBe(true);
  expect(read(path.join(fixture.gamma, 'EPIC.md')).length).toBe(0);
  // The image file and the metadata are untouched; the epic folder holds no leftover file.
  expect(read(path.join(fixture.alpha, 'assets', `${IMAGE_ID}.png`)).equals(PNG)).toBe(true);
  expect(readdirSync(fixture.alpha).sort()).toEqual(['EPIC.md', 'assets', 'epic.json']);
  for (const id of ['ALPHA', 'BETA', 'GAMMA']) {
    expect(readFileSync(path.join(fixture.folder, 'epics', id, 'epic.json'), 'utf8')).toBe(epicJsonBefore[id]);
  }

  // The card side keeps the membership: task.json is unchanged and the epic stores no list of cards.
  for (let id = 1; id <= 6; id++) {
    expect(readFileSync(path.join(fixture.folder, 'tasks', String(id), 'task.json'), 'utf8')).toBe(taskJsonBefore[id]);
  }
  const alphaMeta = JSON.parse(epicJsonBefore.ALPHA);
  expect(Object.keys(alphaMeta).sort()).toEqual(['attachments', 'color', 'createdAt', 'formatVersion', 'id', 'isDraft', 'name', 'updatedAt']);
  const tasks = json(fixture.home, ['ls', '--json']).tasks as { id: number; epicId: string | null }[];
  expect(tasks.map(({ id, epicId }) => [id, epicId])).toEqual([
    [1, 'ALPHA'], [2, 'ALPHA'], [3, 'ALPHA'], [4, 'BETA'], [5, 'BETA'], [6, null],
  ]);

  // Restarting changes nothing either.
  await stopServe(serve);
  serve = await startServe(port, fixture.home);
  expect(read(path.join(fixture.alpha, 'EPIC.md')).equals(before.alpha)).toBe(true);
});

test('the CLI, snapshot, progress, hook, wait, and API return document and documentPath', async () => {
  const alphaPath = path.join(fixture.alpha, 'EPIC.md');

  const shown = json(fixture.home, ['epic', 'show', 'ALPHA', '--json']);
  expect(shown.epic.document).toBe(DOC_ALPHA);
  expect(shown.epic.body).toBe(DOC_ALPHA.split('---\n\n')[1]);
  expect(shown.epic.priority).toEqual([3, 1, 2]);
  expect(shown.epic.priorityError).toBe(false);

  const listed = json(fixture.home, ['epic', 'ls', '--json']);
  expect((listed.epics as { id: string }[]).map((epic) => epic.id)).toEqual(expect.arrayContaining(['ALPHA', 'BETA', 'GAMMA']));
  expect(listed.epics.find((epic: { id: string }) => epic.id === 'BETA')).toMatchObject({ body: DOC_BETA.split('---\n\n')[1], priority: [5, 4] });

  const snapshot = json(fixture.home, ['snapshot', '--json']);
  expect(snapshot.epics.find((epic: { id: string }) => epic.id === 'ALPHA')).toMatchObject({ document: DOC_ALPHA, priority: [3, 1, 2] });

  const progress = json(fixture.home, ['progress', '--json']);
  const alpha = progress.epics.find((epic: { id: string }) => epic.id === 'ALPHA');
  expect(alpha.documentPath).toBe(alphaPath);
  expect(alpha.tasks.map((task: { id: number }) => task.id)).toEqual([3, 1, 2]);
  expect(existsSync(alpha.documentPath)).toBe(true);
  expect(progress.epics.find((epic: { id: string }) => epic.id === 'BETA').tasks.map((task: { id: number }) => task.id)).toEqual([5, 4]);
  expect(progress.unassigned.map((task: { id: number }) => task.id)).toEqual([6]);

  const hook = runWith(fixture.home, ['hook', '--agent', 'claude'], JSON.stringify({ hook_event_name: 'PostToolUse' }));
  expect(hook.status).toBe(0);
  const context = JSON.parse(hook.stdout).hookSpecificOutput.additionalContext as string;
  expect(context.startsWith('AGBOARD_PROGRESS\n')).toBe(true);
  const handed = JSON.parse(context.slice('AGBOARD_PROGRESS\n'.length));
  expect(handed.epics.find((epic: { id: string }) => epic.id === 'ALPHA').documentPath).toBe(alphaPath);

  // `wait --after` returns the new snapshot when an epic document changes.
  const waiter = spawn(agboardBinary(), ['--project', PROJECT, 'wait', '--after', snapshot.cursor, '--timeout', '20', '--json'], {
    env: { ...process.env, AGBOARD_HOME: fixture.home, TZ: 'UTC' },
    cwd: fixture.home,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let waited = '';
  waiter.stdout?.on('data', (chunk) => (waited += chunk));
  const waitExit = new Promise<number | null>((resolve) => waiter.once('exit', resolve));
  await new Promise((resolve) => setTimeout(resolve, 500));
  agboardOk(PROJECT, ['epic', 'edit', 'GAMMA', '--document', 'Wakes the waiting command.\n'], fixture.home);
  expect(await waitExit).toBe(0);
  const woken = JSON.parse(waited);
  expect(woken.epics.find((epic: { id: string }) => epic.id === 'GAMMA').document).toBe('Wakes the waiting command.\n');

  const waitedTask = runWith(fixture.home, ['wait', '--until', 'task', '--idle-timeout', '1', '--json']);
  expect(waitedTask.status, waitedTask.stderr).toBe(0);
  const selected = JSON.parse(waitedTask.stdout);
  expect(selected.kind).toBe('task');
  expect(selected.documentPath).toMatch(/\/epics\/(ALPHA|BETA)\/EPIC\.md$/);
  expect(existsSync(selected.documentPath)).toBe(true);

  const base = `http://127.0.0.1:${port}/api/projects/${projectId(PROJECT, fixture.home)}`;
  const one = await (await fetch(`${base}/epics/ALPHA`)).json();
  expect(one.epic).toMatchObject({ id: 'ALPHA', document: DOC_ALPHA, priority: [3, 1, 2] });
  const all = await (await fetch(`${base}/epics`)).json();
  // The Epic Detail streams the document as blocks; the front matter is not part of the body.
  const detail = (await (await fetch(`${base}/epics/ALPHA/detail?sections=document`)).text())
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const body = detail
    .filter((event: { type: string }) => event.type === 'block')
    .map((event: { text: string }) => event.text)
    .join('\n\n');
  expect(body).toContain('# Alpha document');
  expect(body).toContain('Alpha text.');
  expect(body).not.toContain('priority:');
});

test('the CLI stores the epic details from --document, standard input, and --document-file', async () => {
  const file = path.join(fixture.home, 'from-file.md');
  writeFileSync(file, 'Document from a file.\n');


  const text = agboard(PROJECT, ['epic', 'edit', 'BETA', '--document', '---\npriority: [4, 5]\n---\n\nDocument from text.\n', '--json'], fixture.home);
  expect(text.code, text.stderr).toBe(0);
  expect(JSON.parse(text.stdout).epic).toMatchObject({ body: 'Document from text.\n', priority: [4, 5] });
  expect(readFileSync(path.join(fixture.beta, 'EPIC.md'), 'utf8')).toContain('Document from text.');

  const piped = runWith(fixture.home, ['epic', 'edit', 'GAMMA', '--document', '-'], 'Document from standard input.\n');
  expect(piped.status, piped.stderr).toBe(0);
  expect(readFileSync(path.join(fixture.gamma, 'EPIC.md'), 'utf8')).toContain('Document from standard input.');

  const fromFile = agboard(PROJECT, ['epic', 'edit', 'GAMMA', '--document-file', file, '--json'], fixture.home);
  expect(fromFile.code, fromFile.stderr).toBe(0);
  const gamma = JSON.parse(fromFile.stdout).epic;
  expect(gamma.document).toBe('Document from a file.') /* a file and standard input lose one final newline, as before */;

  const help = agboard(PROJECT, ['epic', 'edit', '--help'], fixture.home);
  expect(help.stdout).toContain('--document-file');

  // Put the epic back for the page scenarios.
  agboardOk(PROJECT, ['epic', 'edit', 'BETA', '--document', DOC_BETA], fixture.home);
  agboardOk(PROJECT, ['epic', 'edit', 'GAMMA', '--document', ''], fixture.home);
});

test('the page shows the epic details with its cards in order and the Markdown image; an edited document survives a restart', async ({ page }) => {
  const url = `http://127.0.0.1:${port}/?project=${projectId(PROJECT, fixture.home)}`;
  await page.goto(url);
  await waitForSync(page);

  // The epic list: the empty document reads as an empty state.
  await page.getByRole('button', { name: 'Epics' }).click();
  await page.getByRole('button', { name: /Gamma epic/ }).first().click();
  await expect(page.getByText('No epic details yet')).toBeVisible();
  await page.getByRole('button', { name: /Alpha epic/ }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Alpha document' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to board' }).click();

  // The epic dialog from a card label: the details label, the cards in priority order, the picture.
  await page.locator('[data-epic-label="ALPHA"]').first().click();
  const dialog = dialogOf(page);
  await expect(dialog).toBeVisible();
  const editor = dialog.getByRole('textbox', { name: 'Epic details (Markdown)' });
  await expect(editor.getByRole('heading', { level: 1, name: 'Alpha document' })).toBeVisible();
  await expect(editor).toContainText('Alpha text.');
  const picture = editor.getByRole('img', { name: 'alpha picture' });
  await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  const order = dialog.getByRole('list', { name: 'Progress' }).getByRole('listitem');
  await expect(order).toHaveCount(3);
  await expect(order.nth(0)).toContainText('#3');
  await expect(order.nth(0).getByRole('button', { name: 'Card 3' })).toBeVisible();
  await expect(order.nth(1)).toContainText('#1');
  await expect(order.nth(2)).toContainText('#2');
  // Cards of another epic, and the card with no epic, are not listed.
  await expect(dialog.getByRole('button', { name: 'Card 4' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Card 6' })).toHaveCount(0);

  // Edit the document and save.
  await editor.getByText('Alpha text.').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Edited in the page.');
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const saved = json(fixture.home, ['epic', 'show', 'ALPHA', '--json']).epic;
  expect(saved.body).toContain('Alpha text. Edited in the page.');
  expect(saved.body).toContain(`assets/${IMAGE_ID}.png`);
  expect(saved.priority).toEqual([3, 1, 2]);
  expect(readFileSync(path.join(fixture.alpha, 'EPIC.md'), 'utf8')).toContain('Edited in the page.');

  // Restart the server and open the page again: the edit, the order, and the picture are still there.
  await stopServe(serve);
  serve = await startServe(port, fixture.home);
  await page.reload();
  await waitForSync(page);
  await page.locator('[data-epic-label="ALPHA"]').first().click();
  await expect(dialog).toBeVisible();
  await expect(editor).toContainText('Alpha text. Edited in the page.');
  await expect.poll(() => editor.getByRole('img', { name: 'alpha picture' }).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  const orderAgain = dialog.getByRole('list', { name: 'Progress' }).getByRole('listitem');
  await expect(orderAgain).toHaveCount(3);
  await expect(orderAgain.nth(0)).toContainText('#3');
  await expect(orderAgain.nth(1)).toContainText('#1');
  await expect(orderAgain.nth(2)).toContainText('#2');
});

test('the Japanese page labels the epic details', async ({ page }) => {
  // This serve and its data area belong to this spec only, so the saved language needs no reset.
  await setPreferences({ locale: 'ja' }, `http://127.0.0.1:${port}`);
  await page.goto(`http://127.0.0.1:${port}/?project=${projectId(PROJECT, fixture.home)}`);
  await page.locator('[data-epic-label="ALPHA"]').first().waitFor();
  await page.locator('[data-epic-label="ALPHA"]').first().click();
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('textbox', { name: 'エピックの詳細 (Markdown)' }) });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '閉じる', exact: true }).first().click();

  await page.getByRole('button', { name: 'エピック' }).first().click();
  await page.getByRole('button', { name: /Gamma epic/ }).first().click();
  await expect(page.getByText('エピックの詳細はまだありません')).toBeVisible();
});
