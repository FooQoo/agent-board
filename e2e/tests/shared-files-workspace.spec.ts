import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  agboard,
  agboardBinary,
  agboardCatalogOk,
  agboardOk,
  mainHome,
  mainOrigin,
  mainProject,
  nextTaskId,
  projectId,
  removeProject,
  replaceFileAtomically,
  replaceTaskBodyPreservingFrontmatter,
  resetBoard,
  taskBody,
  workspace,
} from '../helpers/agboard';
import { openManualCreateDialog, waitForSync } from '../helpers/ui';

// The shared folder as the product keeps it: created by the CLI, read by two working directories, and edited
// directly in its files. These scenarios use the real binary and the real serve on the main port.

const details = (page: Page) => page.getByRole('complementary', { name: 'Task details' });
const task = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });
const folderOf = (project: string) => workspace(project).folder;

/** Open the seeded board by its project ID, so other projects in the data area do not change what is shown. */
async function openBoard(page: Page, project = mainProject): Promise<void> {
  await page.goto(`/?project=${projectId(project)}`);
  await waitForSync(page);
}

/** Run the CLI from `cwd`, the way a working directory of an agent would, against the test data area. */
function cliFrom(cwd: string, args: string[]): { code: number; stdout: string; stderr: string } {
  const result = spawnSync(agboardBinary(), args, {
    cwd,
    env: { ...process.env, AGBOARD_HOME: mainHome(), TZ: 'UTC' },
    encoding: 'utf8',
  });
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

let work: string;

test.beforeAll(() => {
  work = mkdtempSync(path.join(os.tmpdir(), 'agent-board-e2e-shared-'));
});
test.afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});
test.beforeEach(() => {
  resetBoard(mainProject);
});

test('a shared folder and an epic are created by the CLI, and the epic label shows on the task in its colour', async ({ page }) => {
  // A new data area gets the shared folder, a project folder with its ID, and the README.
  const name = `Shared demo ${Date.now()}`;
  agboardCatalogOk(['project', 'create', name]);
  const id = JSON.parse(agboard(name, ['workspace', '--json']).stdout).projectId as string;
  const shared = path.join(mainHome(), 'shared');
  expect(JSON.parse(readFileSync(path.join(shared, 'workspace.json'), 'utf8'))).toEqual({
    format: 'agboard-files',
    formatVersion: 1,
  });
  const folder = JSON.parse(agboard(name, ['workspace', '--json']).stdout).folder as string;
  expect(folder.startsWith(shared)).toBe(true);
  expect(JSON.parse(readFileSync(path.join(folder, 'project.json'), 'utf8'))).toMatchObject({ id, name, nextTaskId: 1 });
  expect(readFileSync(path.join(folder, 'README.md'), 'utf8')).toContain('TASK.md');

  // An epic with an empty document and a colour; a card in it.
  agboardOk(name, ['epic', 'add', 'FILE-SHARE', '--name', 'File share', '--color', '#7C3AED', '--actor', 'human']);
  expect(readFileSync(path.join(folder, 'epics', 'FILE-SHARE', 'EPIC.md'), 'utf8')).toBe('');
  const taskId = JSON.parse(agboardOk(name, ['add', 'Upload a picture', '--epic', 'FILE-SHARE', '--json']).stdout).task.id as number;
  expect(JSON.parse(agboardOk(name, ['ls', '--json']).stdout).tasks.find((c: { id: number }) => c.id === taskId)).toMatchObject({
    epic: { id: 'FILE-SHARE', name: 'File share', color: '#7C3AED' },
  });

  // The page shows the card with the epic label, and only the label takes the epic colour (the card keeps its normal frame).
  await openBoard(page, name);
  const label = page.locator(`[data-epic-label="FILE-SHARE"]`);
  await expect(label).toHaveCount(1);
  await expect(label).toHaveCSS('background-color', 'rgb(124, 58, 237)');
  await expect(task(page, taskId).getByText('FILE-SHARE')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add task', exact: true })).toBeVisible();
  removeProject(name);
});

test('two working directories read and write one shared TASK.md; the page and wait follow the file without a reload', async ({ page }) => {
  const folder = folderOf(mainProject);
  const worktreeA = mkdtempSync(path.join(work, 'worktree-a-'));
  const worktreeB = mkdtempSync(path.join(work, 'worktree-b-'));
  // Both directories see the same shared folder, whatever their own location.
  expect(JSON.parse(cliFrom(worktreeA, ['--project', mainProject, 'workspace', '--json']).stdout).folder).toBe(folder);
  expect(JSON.parse(cliFrom(worktreeB, ['--project', mainProject, 'workspace', '--json']).stdout).folder).toBe(folder);

  await openBoard(page);
  await task(page, 13).click();
  await expect(details(page)).toContainText('Check the layout at 1280, 800, and 480 px.');

  // Worktree B waits for a change; its command is started first.
  const cursor = JSON.parse(cliFrom(worktreeB, ['--project', mainProject, 'snapshot', '--json']).stdout).cursor as string;
  const waiter = spawn(agboardBinary(), ['--project', mainProject, '--json', 'wait', '--after', cursor, '--timeout', '30'], {
    cwd: worktreeB,
    env: { ...process.env, AGBOARD_HOME: mainHome(), TZ: 'UTC' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let waited = '';
  waiter.stdout.on('data', (chunk) => (waited += chunk));
  const waitEnded = new Promise<number | null>((resolve) => waiter.once('exit', (code) => resolve(code)));

  // Worktree A saves its TASK.md with an ordinary file write (in place), with a new line of work.
  const file = path.join(folder, 'tasks', '13', 'TASK.md');
  const original = readFileSync(file, 'utf8');
  writeFileSync(file, original.replace('Check the layout', 'Checked from worktree A. Check the layout'));
  expect(await waitEnded).toBe(0);
  expect(JSON.parse(waited).tasks.find((c: { id: number }) => c.id === 13).description).toContain('Checked from worktree A.');

  // The open page shows the new text with no reload and no manual step.
  await expect(details(page)).toContainText('Checked from worktree A.');

  // A save with the same content is no change: a new wait stays open, and reports nothing when it times out.
  const cursor2 = JSON.parse(cliFrom(worktreeB, ['--project', mainProject, 'snapshot', '--json']).stdout).cursor as string;
  let quietOut = '';
  const quiet = spawn(agboardBinary(), ['--project', mainProject, '--json', 'wait', '--after', cursor2, '--timeout', '6'], {
    cwd: worktreeB,
    env: { ...process.env, AGBOARD_HOME: mainHome(), TZ: 'UTC' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  quiet.stdout.on('data', (chunk) => (quietOut += chunk));
  const quietEnded = new Promise<number | null>((resolve) => quiet.once('exit', (code) => resolve(code)));
  writeFileSync(file, readFileSync(file, 'utf8'));
  await new Promise((resolve) => setTimeout(resolve, 2000));
  expect(quiet.exitCode).toBeNull();
  await quietEnded;
  expect(quietOut).not.toContain('"tasks"');

  // Worktree A's CLI and worktree B's CLI both read the same card, and B can change it too.
  const seen = JSON.parse(cliFrom(worktreeA, ['--project', mainProject, 'show', '13', '--json']).stdout).task;
  expect(seen.description).toContain('Checked from worktree A.');
  const edited = cliFrom(worktreeB, ['--project', mainProject, 'edit', '13', '--title', 'Check the board display']);
  expect(edited.code).toBe(0);
  expect(JSON.parse(cliFrom(worktreeA, ['--project', mainProject, 'show', '13', '--json']).stdout).task.title).toBe(
    'Check the board display',
  );
});

test('an image reference that points at another owner or outside the folder is never shown', async ({ page }) => {
  // Card 14 owns a picture; card 13 refers to it, with a path that is not its own, and to paths outside the folder.
  const owned = path.join(work, 'owned.png');
  writeFileSync(owned, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==', 'base64'));
  const added = JSON.parse(agboardOk(mainProject, ['attachment', 'add', '14', '--file', owned, '--actor', 'ai', '--json']).stdout);
  const otherId = (added.attachment?.id ?? added.id) as string;
  const folder = folderOf(mainProject);
  const body = taskBody(
    [
      `![other task picture](assets/${otherId}.png)`,
      '',
      '![parent folder](../../../../../../etc/passwd.png)',
      '',
      '![absolute](/etc/hosts.png)',
      '',
      '![file url](file:///etc/hosts.png)',
    ].join('\n'),
  );
  replaceTaskBodyPreservingFrontmatter(path.join(folder, 'tasks', '13', 'TASK.md'), body);

  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await openBoard(page);
  await task(page, 13).click();
  // Each reference is a No image placeholder; none of them makes a request to the folder.
  await expect(details(page).getByText('No image', { exact: true })).toHaveCount(4);
  await expect(details(page).locator('img')).toHaveCount(0);
  expect(requests.filter((url) => url.includes(`/tasks/13/assets/`) || url.includes('etc'))).toEqual([]);
  // The owner's picture is reachable only from its own card: asking for it through card 13 is refused.
  const direct = await page.request.get(`${mainOrigin}/api/projects/${projectId(mainProject)}/tasks/13/attachments/${otherId}`);
  expect([403, 404]).toContain(direct.status());
});

test('the editor is not loaded on the first screen, and assets that are not registered answer 404', async ({ page }) => {
  const loaded: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/assets/')) loaded.push(path.basename(url.pathname));
  });
  await openBoard(page);
  // The first screen loads the content-named app bundle and its style only.
  expect(loaded.some((name) => /^app-[\w-]+\.js$/.test(name))).toBe(true);
  expect(loaded.some((name) => /^app-[\w-]+\.css$/.test(name))).toBe(true);
  // The editor, the diagram engines (one chunk per diagram kind, plus its layout and graph code) wait for their use.
  expect(loaded.filter((name) => /RichMarkdownEditor|Diagram|cytoscape|elk|katex|codemirror/i.test(name)), loaded.join(' ')).toEqual([]);

  // Opening the add dialog loads the editor chunk, which the first screen did not need.
  const create = await openManualCreateDialog(page);
  await expect(create.getByRole('textbox', { name: 'Description (Markdown)' })).toBeVisible();
  await expect.poll(() => loaded.some((name) => /RichMarkdownEditor/.test(name))).toBe(true);

  // A name that is not registered is a 404.
  const missing = await page.request.get(`${mainOrigin}/assets/not-registered-${Date.now()}.js`);
  expect(missing.status()).toBe(404);
});

test('a second CLI process reads the same board from another folder while the page is open', async () => {
  // Reading from a fresh process in an unrelated directory gives the same card list as the page sees.
  const elsewhere = mkdtempSync(path.join(work, 'elsewhere-'));
  const id = nextTaskId(mainProject);
  const result = cliFrom(elsewhere, ['--project', mainProject, 'add', 'From another folder', '--assignee', 'ai', '--actor', 'ai']);
  expect(result.code).toBe(0);
  const listed = JSON.parse(cliFrom(elsewhere, ['--project', mainProject, 'ls', '--json']).stdout).tasks as { id: number }[];
  expect(listed.map((c) => c.id)).toContain(id);
});

