import { createHash } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	agboardBinary,
	agboardOk,
	makeHome,
	replaceFileAtomically,
	replaceTaskBodyPreservingFrontmatter,
	workspace,
} from '../helpers/agboard';
import { removeMonitorHome, startPhoneEntrance, type PhoneEntrance } from '../helpers/monitor';
import { waitForSync } from '../helpers/ui';

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1280, height: 900 }, timezoneId: 'UTC', locale: 'en-US' });

const project = 'History Frontmatter E2E';
let home: string;
let pid: string;
// The PC board and the phone monitor of one backend: the phone goes through the ngrok entrance stand-in.
let serve: PhoneEntrance;

interface HistoryEvent { at: string; reason: string; }

interface TaskView {
	id: number;
	title: string;
	taskStatus: string;
	taskStatusChangedAt: string;
	agentStatus: string;
	isDraft: boolean;
	pendingRequestId: string | null;
	description: string;
	body: string;
	acceptance: { id: string; text: string; done: boolean }[];
	history: HistoryEvent[];
	archivedAt: string | null;
}

function cli(args: string[]): { code: number; stdout: string; stderr: string } {
	const result = spawnSync(agboardBinary(), ['--project', project, ...args], {
		cwd: home,
		env: { ...process.env, AGBOARD_HOME: home, TZ: 'UTC' },
		encoding: 'utf8',
	});
	if (result.error) throw result.error;
	return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

function catalog(args: string[]): { code: number; stdout: string; stderr: string } {
	const result = spawnSync(agboardBinary(), args, {
		cwd: home,
		env: { ...process.env, AGBOARD_HOME: home, TZ: 'UTC' },
		encoding: 'utf8',
	});
	if (result.error) throw result.error;
	return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

function cliOk(args: string[]): string {
	const result = cli([...args, '--json']);
	if (result.code !== 0) throw new Error(`agboard ${args.join(' ')} failed (${result.code}): ${result.stderr}`);
	return result.stdout;
}

function show(id: number): TaskView {
	return JSON.parse(cliOk(['show', String(id)]).trim()).task as TaskView;
}

function snapshot(): { cursor: string; tasks: TaskView[]; problems: { file: string; field: string; reason: string }[] } {
	return JSON.parse(cliOk(['snapshot']).trim());
}

function addTask(title: string, description = 'History E2E body.', assignee: 'ai' | 'human' = 'ai'): number {
	const result = JSON.parse(cliOk(['add', title, '--desc', description, '--assignee', assignee, '--actor', 'human']));
	return result.task.id as number;
}

function taskFile(id: number): string {
	return path.join(workspace(project, home).folder, 'tasks', String(id), 'TASK.md');
}

function taskJsonFile(id: number): string {
	return path.join(workspace(project, home).folder, 'tasks', String(id), 'task.json');
}

function details(page: Page) {
	return page.getByRole('complementary', { name: 'Task details' });
}

async function openPc(page: Page): Promise<void> {
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto(`${serve.pcOrigin}/?project=${pid}`);
	await waitForSync(page);
}

function beginWait(cursor: string): { child: ChildProcess; result: Promise<{ code: number | null; stdout: string; stderr: string }> } {
	const child = spawn(agboardBinary(), ['--project', project, 'wait', '--after', cursor, '--timeout', '10', '--json'], {
		cwd: home,
		env: { ...process.env, AGBOARD_HOME: home, TZ: 'UTC' },
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let stdout = '';
	let stderr = '';
	child.stdout?.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
	child.stderr?.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
	const result = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
		child.once('error', reject);
		child.once('close', (code) => resolve({ code, stdout, stderr }));
	});
	return { child, result };
}

function hash(file: string): string {
	return createHash('sha256').update(readFileSync(file)).digest('hex');
}

test.beforeAll(async () => {
	test.setTimeout(240_000);
	home = makeHome('history-frontmatter');
	const created = catalog(['project', 'create', project, '--json']);
	if (created.code !== 0) throw new Error(`project create failed: ${created.stderr}`);
	pid = (JSON.parse(created.stdout) as { project: { id: string } }).project.id;
	serve = await startPhoneEntrance(home);
});

test.afterAll(async () => {
	await serve?.stop();
	if (home) removeMonitorHome(home);
});

test('new task history survives restart and appears in PC and mobile details', async ({ page }) => {
	const id = addTask('History after restart');
	cliOk(['mv', String(id), 'doing', '--actor', 'human', '--reason', 'Start the real task']);
	let task = show(id);
	expect(task.history).toHaveLength(2);
	for (const event of task.history) expect(Object.keys(event).sort()).toEqual(['at', 'reason']);
	expect(task.history.at(-1)).toMatchObject({
		reason: 'Start the real task',
	});
	const metadata = JSON.parse(readFileSync(taskJsonFile(id), 'utf8')) as Record<string, unknown>;
	expect(metadata).toMatchObject({ formatVersion: 1, taskStatus: 'doing' });
	expect(metadata).not.toHaveProperty('history');
	expect(readFileSync(taskFile(id), 'utf8')).toContain('history:');

	await serve.restart();
	await openPc(page);
	await page.getByRole('button', { name: new RegExp(`^#${id} .*History after restart`) }).click();
	const pc = details(page);
	await pc.getByRole('tab', { name: /^History/ }).click();
	await expect(pc.getByRole('tabpanel')).toContainText('Start the real task');

	await page.setViewportSize({ width: 375, height: 812 });
	await page.goto(`${serve.phoneOrigin}/monitor/`);
	const monitorTask = page.getByRole('article', { name: new RegExp(`History after restart`) });
	await monitorTask.getByRole('button', { name: 'History after restart', exact: true }).click();
	const drawer = page.getByRole('dialog', { name: 'History after restart' });
	await drawer.getByRole('tab', { name: 'History', exact: true }).click();
	await expect(drawer.getByRole('tabpanel')).toContainText('Start the real task');
	task = show(id);
	expect(task.history).toHaveLength(2);
});

test('a mobile answer updates TASK.md, resumes wait, and exposes the same answer in show', async ({ page }) => {
	const id = addTask('Pending history answer');
	cliOk(['mv', String(id), 'doing', '--actor', 'ai', '--reason', 'Begin review']);
	const request = {
		question: 'Which release should ship?',
		choices: [{ id: 'a', label: 'Plan A' }, { id: 'b', label: 'Plan B' }],
	};
	cliOk(['state', String(id), 'pending', '--actor', 'ai', '--request-json', JSON.stringify(request)]);
	const pending = show(id);
	const requestId = pending.pendingRequestId;
	expect(requestId).toBeTruthy();
	const pendingCursor = snapshot().cursor;
	const waiting = beginWait(pendingCursor);
	await new Promise((resolve) => setTimeout(resolve, 150));
	await page.setViewportSize({ width: 375, height: 812 });
	await page.goto(`${serve.phoneOrigin}/monitor/`);
	const article = page.getByRole('article', { name: new RegExp(`Pending history answer`) });
	await expect(article.getByRole('region', { name: 'The agent is waiting for your answer' })).toBeVisible();
	await article.getByRole('radio', { name: 'Plan B' }).check();
	await article.getByRole('textbox', { name: 'Your answer' }).fill('Ship the stable release.');
	const answerRequest = page.waitForResponse((response) =>
		response.url().includes(`/tasks/${id}/answer`) && response.request().method() === 'POST');
	await article.getByRole('button', { name: 'Send', exact: true }).click();
	expect((await answerRequest).status()).toBe(200);
	await expect(article.getByRole('region', { name: 'The agent is waiting for your answer' })).toHaveCount(0);

	const waited = await waiting.result;
	expect(waited.code, waited.stderr).toBe(0);
	const waitSnapshot = JSON.parse(waited.stdout) as { cursor: string; tasks: TaskView[] };
	expect(waitSnapshot.cursor).not.toBe(pendingCursor);
	const task = show(id);
	expect(task.agentStatus).toBe('idle');
	expect(task.history.at(-1)).toMatchObject({ reason: expect.stringContaining('Ship the stable release.') });
	const metadata = JSON.parse(readFileSync(taskJsonFile(id), 'utf8'));
	expect(metadata.pendingRequest).toBeNull();
	expect(metadata.requestAnswers.at(-1)).toMatchObject({ requestId, actor: 'human', choiceId: 'b', choiceLabel: 'Plan B', text: 'Ship the stable release.' });
	expect(task.history.at(-1)?.reason).toContain('Plan B');
	expect(readFileSync(taskFile(id), 'utf8')).toContain('Ship the stable release.');
	const stale = cli(['state', String(id), 'idle', '--actor', 'human', '--request', requestId!, '--reason', 'Late answer', '--json']);
	expect(stale.code).not.toBe(0);
	await openPc(page);
	await page.getByRole('button', { name: new RegExp(`^#${id} .*Pending history answer`) }).click();
	await details(page).getByRole('tab', { name: /^History/ }).click();
	await expect(details(page).getByRole('tabpanel')).toContainText('Ship the stable release.');
});

test('saving a body edit after a concurrent lane change keeps the newest event and CLI replacements keep history', async ({ page }) => {
	const id = addTask('Concurrent edit history', '## Work\n\nOriginal body.');
	await openPc(page);
	await page.getByRole('button', { name: new RegExp(`^#${id} .*Concurrent edit history`) }).click();
	const panel = details(page);
	await panel.getByRole('button', { name: 'Make draft' }).click();
	await panel.getByRole('button', { name: 'Edit task', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: new RegExp(`^#${id} Edit task`) });
	const editor = dialog.getByRole('textbox', { name: 'Description (Markdown)' });
	await expect(editor.getByText('Original body.')).toBeVisible();
	await editor.getByText('Original body.').click();
	await page.keyboard.press('End');
	await page.keyboard.type('\nSaved after status update.');
	const moved = await page.evaluate(async ({ taskId, projectId }) => {
		const token = document.querySelector('meta[name="agboard-token"]')?.getAttribute('content') ?? '';
		const response = await fetch(`/api/projects/${projectId}/tasks/${taskId}/move`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Agboard-Token': token },
			body: JSON.stringify({ taskStatus: 'doing', reason: 'Concurrent lane update' }),
		});
		return response.status;
	}, { taskId: id, projectId: pid });
	expect(moved).toBe(200);
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(dialog).toHaveCount(0);
	let task = show(id);
	expect(task.body).toContain('Saved after status update.');
	expect(task.taskStatus).toBe('doing');
	expect(task.history.at(-1)).toMatchObject({ reason: 'Concurrent lane update' });
	expect(task.history.filter((event) => event.reason === 'Concurrent lane update')).toHaveLength(1);
	await panel.getByRole('button', { name: 'Finalize', exact: true }).click();

	const replacement = path.join(home, 'replacement.md');
	replaceFileAtomically(replacement, '## Work\n\nCLI replacement without a history field.\n');
	cliOk(['edit', String(id), '--desc-file', replacement]);
	task = show(id);
	expect(task.body).toContain('CLI replacement without a history field.');
	expect(task.history).toHaveLength(4);
	expect(task.history.some((event) => event.reason === 'Concurrent lane update')).toBe(true);
	expect(task.history.at(-1)?.reason).toContain('draft');
	expect(readFileSync(taskFile(id), 'utf8')).toContain('Concurrent lane update');
});

test('auto-Done is recorded once, and archive/restore retain their history in the archive screen', async ({ page }) => {
	const id = addTask('Automatic completion history', '---\nacceptance:\n  - id: AC-1\n    text: All work is complete\n    done: false\n---\n\nComplete this task.');
	cliOk(['mv', String(id), 'doing', '--actor', 'ai', '--reason', 'Start completed work']);
	const file = taskFile(id);
	const original = readFileSync(file, 'utf8');
	const completed = original.replace('done: false', 'done: true');
	expect(completed).not.toBe(original);
	replaceFileAtomically(file, completed);
	await expect.poll(() => show(id).taskStatus).toBe('done');
	let task = show(id);
	const automaticDone = task.history.filter((event) =>
		event.reason.includes('All acceptance conditions are complete.'));
	expect(automaticDone).toHaveLength(1);
	const afterDone = task.history.length;
	replaceFileAtomically(file, readFileSync(file, 'utf8'));
	await page.waitForTimeout(300);
	task = show(id);
	expect(task.history).toHaveLength(afterDone);

	await openPc(page);
	await page.getByRole('button', { name: new RegExp(`^#${id} .*Automatic completion history`) }).click();
	const panel = details(page);
	await panel.getByRole('button', { name: 'Archive task' }).click();
	await panel.getByRole('group', { name: new RegExp(`Archive #${id}`) }).getByRole('button', { name: 'Archive', exact: true }).click();
	await page.getByRole('banner').getByRole('button', { name: 'Archive', exact: true }).click();
	const archived = page.locator('.archive-row > button').filter({ hasText: 'Automatic completion history' });
	await expect(archived).toBeVisible();
	await archived.click();
	await panel.getByRole('tab', { name: /^History/ }).click();
	await expect(panel.getByRole('tabpanel')).toContainText('Archive');
	await expect(panel.getByRole('tabpanel')).toContainText('All acceptance conditions are complete.');
	await panel.getByRole('button', { name: 'Restore', exact: true }).click();
	await expect.poll(() => show(id).archivedAt).toBeNull();
	task = show(id);
	expect(task.history.filter((event) => event.reason.includes('Archived'))).toHaveLength(1);
	expect(task.history.filter((event) => event.reason.includes('Restored'))).toHaveLength(1);
	expect(readFileSync(file, 'utf8')).toContain('Restored');
});

test('direct TASK.md edits advance watch and wait; invalid history stays visible and rejects writes unchanged', async ({ page }) => {
	const id = addTask('Direct history edits', 'Before external edit.');
	await openPc(page);
	const before = snapshot();
	const wait = beginWait(before.cursor);
	await new Promise((resolve) => setTimeout(resolve, 150));
	replaceTaskBodyPreservingFrontmatter(taskFile(id), 'After external edit.');
	const waited = await wait.result;
	expect(waited.code, waited.stderr).toBe(0);
	const next = JSON.parse(waited.stdout) as { cursor: string; tasks: TaskView[] };
	expect(next.cursor).not.toBe(before.cursor);
	await expect.poll(() => show(id).body).toContain('After external edit.');
	await page.reload();
	await waitForSync(page);
	await page.getByRole('button', { name: new RegExp(`^#${id} .*Direct history edits`) }).click();
	await expect(details(page).getByRole('tabpanel')).toContainText('After external edit.');

	const invalid = `---\nacceptance:\n  - id: AC-1\n    text: Valid acceptance remains readable\n    done: false\nhistory: null\n---\n\nBody with invalid history.`;
	replaceFileAtomically(taskFile(id), invalid);
	await expect.poll(() => snapshot().problems.some((problem) => problem.file.endsWith(`tasks/${id}/TASK.md`))).toBe(true);
	const beforeRejectedWrite = readFileSync(taskFile(id), 'utf8');
	const refused = cli(['mv', String(id), 'doing', '--actor', 'human', '--reason', 'Must be refused']);
	expect(refused.code).not.toBe(0);
	expect(readFileSync(taskFile(id), 'utf8')).toBe(beforeRejectedWrite);
	const broken = showFromSnapshot(id);
	expect(broken.body).toBe('Body with invalid history.');
	expect(broken.acceptance[0]).toMatchObject({ id: 'AC-1', done: false });
	expect(broken.history).toEqual([]);
});

function showFromSnapshot(id: number): TaskView {
	const task = snapshot().tasks.find((item) => item.id === id);
	if (!task) throw new Error(`task ${id} is missing from lenient snapshot`);
	return task;
}

for (const version of [0, 2, 3]) test(`version-${version} task files are refused without changing any bytes`, async () => {
	const id = addTask('Unsupported old task');
	const metadataFile = taskJsonFile(id);
	const metadata = JSON.parse(readFileSync(metadataFile, 'utf8')) as Record<string, unknown>;
	replaceFileAtomically(metadataFile, `${JSON.stringify({ ...metadata, formatVersion: version }, null, 2)}\n`);
	const before = [hash(metadataFile), hash(taskFile(id))];
	const result = snapshot();
	expect(result.tasks.some((task) => task.id === id)).toBe(false);
	expect(result.problems.some((problem) => problem.file.endsWith(`tasks/${id}/task.json`))).toBe(true);
	const strict = cli(['show', String(id), '--json']);
	expect(strict.code).not.toBe(0);
	expect([hash(metadataFile), hash(taskFile(id))]).toEqual(before);
});

test('history add timestamps free work notes and defaults without changing lane timestamps', async ({ page }) => {
  const id = addTask('AI work notes');
  const initial = show(id);
  const before = Date.now();
  cliOk(['history', 'add', String(id), '--reason', 'AI checked the implementation.\nAll targeted tests passed.']);
  const recorded = show(id);
  expect(recorded.history.at(-1)).toEqual({ at: expect.any(String), reason: 'AI checked the implementation.\nAll targeted tests passed.' });
  expect(Date.parse(recorded.history.at(-1)!.at)).toBeGreaterThanOrEqual(before - 1000);
  expect(Date.parse(recorded.history.at(-1)!.at)).toBeLessThanOrEqual(Date.now() + 1000);
  expect(recorded.taskStatusChangedAt).toBe(initial.taskStatusChangedAt);
  cliOk(['history', 'add', String(id)]);
  expect(show(id).history.at(-1)?.reason).toMatch(/todo/i);
  expect(show(id).history.at(-1)?.reason).toMatch(/idle/i);
  const reasonFile = path.join(home, 'work-note.txt');
  replaceFileAtomically(reasonFile, 'Verified persistence after restart.');
  cliOk(['history', 'add', String(id), '--reason-file', reasonFile]);
  expect(show(id).history.at(-1)?.reason).toBe('Verified persistence after restart.');
  await openPc(page);
  await page.getByRole('button', { name: new RegExp(`^#${id} .*AI work notes`) }).click();
  await details(page).getByRole('tab', { name: /^History/ }).click();
  const rows = details(page).getByRole('tabpanel').getByRole('listitem');
  await expect(rows.first()).toContainText('Verified persistence after restart.');
  await expect(rows).toHaveCount(4);
  await expect(details(page).getByRole('tabpanel')).toContainText('All targeted tests passed.');
  const unchanged = show(id);
  cliOk(['mv', String(id), 'todo', '--actor', 'human']);
  cliOk(['state', String(id), 'idle', '--actor', 'ai']);
  expect(show(id).history).toEqual(unchanged.history);
  expect(show(id).taskStatusChangedAt).toBe(initial.taskStatusChangedAt);
});

for (const [name, record] of [
  ['unknown field', { at: '2026-10-15T00:00:00Z', reason: 'Work note', kind: 'agent' }],
  ['invalid timestamp', { at: 'not-a-timestamp', reason: 'Work note' }],
  ['empty reason', { at: '2026-10-15T00:00:00Z', reason: '' }],
] as const) test(`invalid history ${name} is reported and refuses append without changing TASK.md`, async () => {
  const id = addTask(`Invalid history: ${name}`);
  replaceFileAtomically(taskFile(id), `---\nhistory: ${JSON.stringify([record])}\n---\n\nReadable body.`);
  const before = hash(taskFile(id));
  expect(snapshot().problems.some((problem) => problem.file.endsWith(`tasks/${id}/TASK.md`) && problem.field.startsWith('history'))).toBe(true);
  expect(showFromSnapshot(id).body).toBe('Readable body.');
  expect(showFromSnapshot(id).history).toEqual([]);
  expect(cli(['history', 'add', String(id), '--reason', 'Must be refused']).code).not.toBe(0);
  expect(hash(taskFile(id))).toBe(before);
});
