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
import {
	removeMonitorHome,
	startMonitorServe,
	stopMonitorServe,
	type MonitorServe,
} from '../helpers/monitor';
import { waitForSync } from '../helpers/ui';

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1280, height: 900 }, timezoneId: 'UTC', locale: 'en-US' });

const project = 'History Frontmatter E2E';
const localPort = 8550;
const remotePort = 8551;
let home: string;
let pid: string;
let serve: MonitorServe | undefined;

interface HistoryEvent {
	id: string;
	kind: string;
	actor: string;
	reason: string | null;
	fromCardStatus: string | null;
	toCardStatus: string;
	fromAgentStatus: string | null;
	toAgentStatus: string;
	requestId: string | null;
	answer?: string | null;
	question?: string;
	choices?: { id: string; label: string }[];
}

interface CardView {
	id: number;
	title: string;
	cardStatus: string;
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

function show(id: number): CardView {
	return JSON.parse(cliOk(['show', String(id)]).trim()).card as CardView;
}

function snapshot(): { cursor: string; cards: CardView[]; problems: { file: string; field: string; reason: string }[] } {
	return JSON.parse(cliOk(['snapshot']).trim());
}

function addCard(title: string, description = 'History E2E body.', assignee: 'ai' | 'human' = 'ai'): number {
	const result = JSON.parse(cliOk(['add', title, '--desc', description, '--assignee', assignee, '--actor', 'human']));
	return result.card.id as number;
}

function taskFile(id: number): string {
	return path.join(workspace(project, home).folder, 'tasks', String(id), 'TASK.md');
}

function taskJsonFile(id: number): string {
	return path.join(workspace(project, home).folder, 'tasks', String(id), 'task.json');
}

function details(page: Page) {
	return page.getByRole('complementary', { name: 'Card details' });
}

async function openPc(page: Page): Promise<void> {
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto(`http://127.0.0.1:${localPort}/?project=${pid}`);
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

async function routeMonitorAnswer(page: Page): Promise<void> {
	await page.route('**/monitor/api/projects/*/cards/*/answer', async (route) => {
		const target = route.request().url();
		const token = await page.locator('meta[name="agboard-monitor-token"]').getAttribute('content');
		const upstream = await page.request.post(target, {
			headers: {
				Host: 'monitor.e2e.invalid',
				Origin: 'https://monitor.e2e.invalid',
				'Sec-Fetch-Site': 'same-origin',
				'X-Agboard-Token': token ?? '',
			},
			data: route.request().postDataJSON(),
		});
		await route.fulfill({ response: upstream });
	});
}

function hash(file: string): string {
	return createHash('sha256').update(readFileSync(file)).digest('hex');
}

test.beforeAll(async () => {
	home = makeHome('history-frontmatter');
	const created = catalog(['project', 'create', project, '--json']);
	if (created.code !== 0) throw new Error(`project create failed: ${created.stderr}`);
	pid = (JSON.parse(created.stdout) as { project: { id: string } }).project.id;
	serve = await startMonitorServe(home, { monitorPort: localPort, remotePort });
});

test.afterAll(async () => {
	await stopMonitorServe(serve);
	if (home) removeMonitorHome(home);
});

test('new card history survives restart and appears in PC and mobile details', async ({ page }) => {
	const id = addCard('History after restart');
	cliOk(['mv', String(id), 'doing', '--actor', 'human', '--reason', 'Start the real task']);
	let card = show(id);
	expect(card.history.map((event) => event.kind)).toEqual(['created', 'lane']);
	expect(card.history.at(-1)).toMatchObject({
		actor: 'human', reason: 'Start the real task', fromCardStatus: 'todo', toCardStatus: 'doing',
	});
	const metadata = JSON.parse(readFileSync(taskJsonFile(id), 'utf8')) as Record<string, unknown>;
	expect(metadata).toMatchObject({ formatVersion: 2, cardStatus: 'doing' });
	expect(metadata).not.toHaveProperty('history');
	expect(readFileSync(taskFile(id), 'utf8')).toContain('history:');

	await stopMonitorServe(serve);
	serve = await startMonitorServe(home, { monitorPort: localPort, remotePort });
	await openPc(page);
	await page.getByRole('button', { name: new RegExp(`^#${id} .*History after restart`) }).click();
	const pc = details(page);
	await pc.getByRole('tab', { name: /^History/ }).click();
	await expect(pc.getByRole('tabpanel')).toContainText('Start the real task');

	await page.setViewportSize({ width: 375, height: 812 });
	await page.goto(`http://127.0.0.1:${remotePort}/monitor/`);
	const monitorCard = page.getByRole('article', { name: new RegExp(`History after restart`) });
	await monitorCard.getByRole('button', { name: 'History after restart', exact: true }).click();
	const drawer = page.getByRole('dialog', { name: 'History after restart' });
	await drawer.getByRole('tab', { name: 'History', exact: true }).click();
	await expect(drawer.getByRole('tabpanel')).toContainText('Start the real task');
	card = show(id);
	expect(card.history).toHaveLength(2);
});

test('a mobile answer updates TASK.md, resumes wait, and exposes the same answer in show', async ({ page }) => {
	const id = addCard('Pending history answer');
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
	await routeMonitorAnswer(page);
	await page.setViewportSize({ width: 375, height: 812 });
	await page.goto(`http://127.0.0.1:${remotePort}/monitor/`);
	const article = page.getByRole('article', { name: new RegExp(`Pending history answer`) });
	await expect(article.getByRole('region', { name: 'The agent is waiting for your answer' })).toBeVisible();
	await article.getByRole('radio', { name: 'Plan B' }).check();
	await article.getByRole('textbox', { name: 'Your answer' }).fill('Ship the stable release.');
	const answerRequest = page.waitForResponse((response) =>
		response.url().includes(`/cards/${id}/answer`) && response.request().method() === 'POST');
	await article.getByRole('button', { name: 'Send', exact: true }).click();
	expect((await answerRequest).status()).toBe(200);
	await expect(article.getByRole('region', { name: 'The agent is waiting for your answer' })).toHaveCount(0);

	const waited = await waiting.result;
	expect(waited.code, waited.stderr).toBe(0);
	const waitSnapshot = JSON.parse(waited.stdout) as { cursor: string; cards: CardView[] };
	expect(waitSnapshot.cursor).not.toBe(pendingCursor);
	const card = show(id);
	expect(card.agentStatus).toBe('idle');
	expect(card.history.at(-1)).toMatchObject({ kind: 'answer', actor: 'human', reason: 'Ship the stable release.' });
	expect(card.description).toContain('question: Which release should ship?');
	expect(card.description).toContain('label: Plan B');
	expect(readFileSync(taskFile(id), 'utf8')).toContain('Ship the stable release.');
	const stale = cli(['state', String(id), 'idle', '--actor', 'human', '--request', requestId!, '--reason', 'Late answer', '--json']);
	expect(stale.code).not.toBe(0);
	await openPc(page);
	await page.getByRole('button', { name: new RegExp(`^#${id} .*Pending history answer`) }).click();
	await details(page).getByRole('tab', { name: /^History/ }).click();
	await expect(details(page).getByRole('tabpanel')).toContainText('Ship the stable release.');
});

test('saving a body edit after a concurrent lane change keeps the newest event and CLI replacements keep history', async ({ page }) => {
	const id = addCard('Concurrent edit history', '## Work\n\nOriginal body.');
	await openPc(page);
	await page.getByRole('button', { name: new RegExp(`^#${id} .*Concurrent edit history`) }).click();
	const panel = details(page);
	await panel.getByRole('button', { name: 'Make draft' }).click();
	await panel.getByRole('button', { name: 'Edit card', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: new RegExp(`^#${id} Edit card`) });
	const editor = dialog.getByRole('textbox', { name: 'Description (Markdown)' });
	await expect(editor.getByText('Original body.')).toBeVisible();
	await editor.getByText('Original body.').click();
	await page.keyboard.press('End');
	await page.keyboard.type('\nSaved after status update.');
	const moved = await page.evaluate(async ({ cardId, projectId }) => {
		const token = document.querySelector('meta[name="agboard-token"]')?.getAttribute('content') ?? '';
		const response = await fetch(`/api/projects/${projectId}/cards/${cardId}/move`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Agboard-Token': token },
			body: JSON.stringify({ cardStatus: 'doing', reason: 'Concurrent lane update' }),
		});
		return response.status;
	}, { cardId: id, projectId: pid });
	expect(moved).toBe(200);
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(dialog).toHaveCount(0);
	let card = show(id);
	expect(card.body).toContain('Saved after status update.');
	expect(card.cardStatus).toBe('doing');
	expect(card.history.at(-1)).toMatchObject({ kind: 'lane', reason: 'Concurrent lane update' });
	expect(card.history.filter((event) => event.kind === 'lane')).toHaveLength(1);
	await panel.getByRole('button', { name: 'Finalize', exact: true }).click();

	const replacement = path.join(home, 'replacement.md');
	replaceFileAtomically(replacement, '## Work\n\nCLI replacement without a history field.\n');
	cliOk(['edit', String(id), '--desc-file', replacement]);
	card = show(id);
	expect(card.body).toContain('CLI replacement without a history field.');
	expect(card.history).toHaveLength(4);
	expect(card.history.some((event) => event.kind === 'lane' && event.reason === 'Concurrent lane update')).toBe(true);
	expect(card.history.at(-1)).toMatchObject({ kind: 'draft' });
	expect(readFileSync(taskFile(id), 'utf8')).toContain('kind: lane');
});

test('auto-Done is recorded once, and archive/restore retain their history in the archive screen', async ({ page }) => {
	const id = addCard('Automatic completion history', '---\nacceptance:\n  - id: AC-1\n    text: All work is complete\n    done: false\n---\n\nComplete this task.');
	cliOk(['mv', String(id), 'doing', '--actor', 'ai', '--reason', 'Start completed work']);
	const file = taskFile(id);
	const original = readFileSync(file, 'utf8');
	const completed = original.replace('done: false', 'done: true');
	expect(completed).not.toBe(original);
	replaceFileAtomically(file, completed);
	await expect.poll(() => show(id).cardStatus).toBe('done');
	let card = show(id);
	const automaticDone = card.history.filter((event) =>
		event.kind === 'lane' && event.toCardStatus === 'done' && event.reason === 'All acceptance conditions are complete.');
	expect(automaticDone).toHaveLength(1);
	const afterDone = card.history.length;
	replaceFileAtomically(file, readFileSync(file, 'utf8'));
	await page.waitForTimeout(300);
	card = show(id);
	expect(card.history).toHaveLength(afterDone);

	await openPc(page);
	await page.getByRole('button', { name: new RegExp(`^#${id} .*Automatic completion history`) }).click();
	const panel = details(page);
	await panel.getByRole('button', { name: 'Archive card' }).click();
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
	card = show(id);
	expect(card.history.filter((event) => event.kind === 'archive')).toHaveLength(1);
	expect(card.history.filter((event) => event.kind === 'restore')).toHaveLength(1);
	expect(readFileSync(file, 'utf8')).toContain('kind: restore');
});

test('direct TASK.md edits advance watch and wait; invalid history stays visible and rejects writes unchanged', async ({ page }) => {
	const id = addCard('Direct history edits', 'Before external edit.');
	await openPc(page);
	const before = snapshot();
	const wait = beginWait(before.cursor);
	await new Promise((resolve) => setTimeout(resolve, 150));
	replaceTaskBodyPreservingFrontmatter(taskFile(id), 'After external edit.');
	const waited = await wait.result;
	expect(waited.code, waited.stderr).toBe(0);
	const next = JSON.parse(waited.stdout) as { cursor: string; cards: CardView[] };
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

function showFromSnapshot(id: number): CardView {
	const card = snapshot().cards.find((item) => item.id === id);
	if (!card) throw new Error(`card ${id} is missing from lenient snapshot`);
	return card;
}

test('version-one task files are refused without changing any bytes', async () => {
	const id = addCard('Unsupported old task');
	const metadataFile = taskJsonFile(id);
	const metadata = JSON.parse(readFileSync(metadataFile, 'utf8')) as Record<string, unknown>;
	replaceFileAtomically(metadataFile, `${JSON.stringify({ ...metadata, formatVersion: 1 }, null, 2)}\n`);
	const before = [hash(metadataFile), hash(taskFile(id))];
	const result = snapshot();
	expect(result.cards.some((card) => card.id === id)).toBe(false);
	expect(result.problems.some((problem) => problem.file.endsWith(`tasks/${id}/task.json`))).toBe(true);
	const strict = cli(['show', String(id), '--json']);
	expect(strict.code).not.toBe(0);
	expect([hash(metadataFile), hash(taskFile(id))]).toEqual(before);
});
