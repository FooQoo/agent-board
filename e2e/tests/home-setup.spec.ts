import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { agboardBinary, replaceFileAtomically } from '../helpers/agboard';

// `agboard setup` and a CLI project that uses the shared folder it prepares, run with the real binary.
// Every run has a cleared environment (only HOME and TZ), a temporary HOME, and no server or port.

const CODEX_SENTINEL = [
	'# keep this comment',
	'model = "gpt-sentinel"',
	'sandbox_mode = "workspace-write"',
	'',
	'[sandbox_workspace_write]',
	'# other roots stay',
	'writable_roots = ["/sentinel/other"]',
	'network_access = false',
	'',
	'[tui]',
	'theme = "sentinel"',
	'',
].join('\n');

const CLAUDE_SENTINEL = `${JSON.stringify(
	{
		model: 'sentinel-model',
		permissions: {
			allow: ['Read'],
			ask: ['Bash(git push:*)'],
			deny: ['Read(.env)'],
			defaultMode: 'acceptEdits',
			additionalDirectories: ['/sentinel/other'],
		},
		hooks: { Stop: [{ hooks: [{ type: 'command', command: 'sentinel-hook' }] }] },
		futureKey: { kept: true },
	},
	null,
	2,
)}\n`;

const TASK_TEXT = '---\nacceptance:\n  - id: AC-1\n    text: Works\n    done: false\n---\n\nFirst body.';

interface CliResult {
	code: number;
	stdout: string;
	stderr: string;
}

interface SetupJson {
	dataDir: string;
	sharedDir: string;
	dryRun: boolean;
	restartRequired: boolean;
	agents: { agent: string; status: string; changes: string[]; backupPath: string | null }[];
}

interface CardJson {
	id: number;
	title: string;
	body: string;
	acceptance: { id: string; text: string; done: boolean }[];
	history: { at: string; reason: string }[];
}

let root: string;
let home: string;
let dataRoot: string;
let codexConfig: string;
let claudeSettings: string;

test.beforeEach(() => {
	root = mkdtempSync(path.join(os.tmpdir(), 'agent-board-e2e-home-setup-'));
	home = path.join(root, 'home');
	dataRoot = path.join(home, '.agent-board');
	codexConfig = path.join(home, '.codex', 'config.toml');
	claudeSettings = path.join(home, '.claude', 'settings.json');
	mkdirSync(path.dirname(codexConfig), { recursive: true });
	mkdirSync(path.dirname(claudeSettings), { recursive: true });
	writeFileSync(codexConfig, CODEX_SENTINEL);
	writeFileSync(claudeSettings, CLAUDE_SENTINEL);
});

test.afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

/**
 * Run the binary with a cleared environment: only HOME and TZ, plus `env`. Nothing from the developer's shell
 * (AGBOARD_HOME, CODEX_HOME, CLAUDE_CONFIG_DIR) reaches the run unless the test passes it.
 */
function cli(args: string[], options: { cwd?: string; env?: Record<string, string> } = {}): CliResult {
	const result = spawnSync(agboardBinary(), args, {
		cwd: options.cwd ?? home,
		env: { HOME: home, TZ: 'UTC', ...options.env },
		encoding: 'utf8',
		input: '',
	});
	if (result.error) throw result.error;
	return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

function cliOk(args: string[], options: { cwd?: string; env?: Record<string, string> } = {}): CliResult {
	const result = cli(args, options);
	if (result.code !== 0) throw new Error(`agboard ${args.join(' ')} exited ${result.code}: ${result.stderr}`);
	return result;
}

/** `agboard --json setup`, which must succeed; `env` adds variables to the cleared environment. */
function setup(args: string[] = [], env?: Record<string, string>): SetupJson {
	return JSON.parse(cliOk(['--json', 'setup', ...args], { env }).stdout) as SetupJson;
}

/** The SHA-256 of every file under `dir`, keyed by its path relative to `dir`. */
function hashes(dir: string): Record<string, string> {
	const out: Record<string, string> = {};
	if (!existsSync(dir)) return out;
	const walk = (current: string): void => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const file = path.join(current, entry.name);
			if (entry.isDirectory()) walk(file);
			else out[path.relative(dir, file)] = createHash('sha256').update(readFileSync(file)).digest('hex');
		}
	};
	walk(dir);
	return out;
}

/** The backup files setup wrote next to `file`. */
function backupsOf(file: string): string[] {
	const name = path.basename(file);
	return readdirSync(path.dirname(file)).filter((entry) => entry.startsWith(`${name}.agboard-backup`));
}

/** Parse a TOML file with Python's tomllib, so the checks read keys instead of matching text. */
function readToml(file: string): Record<string, unknown> {
	const script = 'import json, sys, tomllib\nwith open(sys.argv[1], "rb") as f:\n    print(json.dumps(tomllib.load(f)))';
	const result = spawnSync('python3', ['-I', '-c', script, file], { encoding: 'utf8' });
	if (result.status !== 0) throw new Error(`python3 could not parse ${file}: ${result.stderr}`);
	return JSON.parse(result.stdout) as Record<string, unknown>;
}

/** Create a project from a folder inside the temporary root, the way a person would from a project folder. */
function createProject(name: string): void {
	const folder = path.join(root, 'work', 'app');
	mkdirSync(folder, { recursive: true });
	cliOk(['project', 'create', name], { cwd: folder });
}

test('the default root is <HOME>/.agent-board, AGBOARD_HOME overrides it, and an empty AGBOARD_HOME is ignored', () => {
	const custom = path.join(root, 'custom-data');

	expect(setup(['--dry-run']).dataDir).toBe(dataRoot);
	expect(setup(['--dry-run'], { AGBOARD_HOME: custom }).dataDir).toBe(custom);
	expect(setup(['--dry-run'], { AGBOARD_HOME: '' }).dataDir).toBe(dataRoot);

	// An override is also where the real run creates the data root and its shared folder.
	const applied = setup([], { AGBOARD_HOME: custom });
	expect(applied.sharedDir).toBe(path.join(custom, 'shared'));
	expect(existsSync(path.join(custom, 'shared'))).toBe(true);
	expect(existsSync(dataRoot)).toBe(false);
});

test('a dry run prints the planned change and leaves every file in HOME unchanged', () => {
	const before = hashes(home);

	const result = cliOk(['setup', '--dry-run']);

	expect(result.stdout).toContain('Dry run: no files, folders, or backups were created.');
	expect(result.stdout).toContain(`Codex: planned ${codexConfig}`);
	expect(result.stdout).toContain(`Claude Code: planned ${claudeSettings}`);
	expect(result.stdout).toContain(`add "${dataRoot}" to sandbox_workspace_write.writable_roots`);
	expect(result.stdout).toContain(`add "${dataRoot}" to permissions.additionalDirectories`);
	expect(hashes(home)).toEqual(before);
	expect(existsSync(dataRoot)).toBe(false);
});

test('applying creates the data root and shared folder, updates both settings, and backs up each changed file once', () => {
	const codexOriginal = readFileSync(codexConfig, 'utf8');
	const claudeOriginal = readFileSync(claudeSettings, 'utf8');

	const json = setup();

	expect(json.dataDir).toBe(dataRoot);
	expect(json.dryRun).toBe(false);
	expect(json.agents.map((agent) => agent.status)).toEqual(['updated', 'updated']);
	expect(existsSync(path.join(dataRoot, 'shared'))).toBe(true);
	expect(existsSync(path.join(dataRoot, 'shared', 'projects'))).toBe(false);

	const codex = readToml(codexConfig);
	expect(codex).toMatchObject({
		model: 'gpt-sentinel',
		sandbox_mode: 'workspace-write',
		sandbox_workspace_write: { writable_roots: ['/sentinel/other', dataRoot], network_access: false },
		tui: { theme: 'sentinel' },
	});
	const codexText = readFileSync(codexConfig, 'utf8');
	expect(codexText).toContain('# keep this comment');
	expect(codexText).toContain('# other roots stay');

	const claude = JSON.parse(readFileSync(claudeSettings, 'utf8')) as Record<string, unknown>;
	expect(claude).toMatchObject({
		model: 'sentinel-model',
		permissions: {
			allow: ['Read'],
			ask: ['Bash(git push:*)'],
			deny: ['Read(.env)'],
			defaultMode: 'acceptEdits',
			additionalDirectories: ['/sentinel/other', dataRoot],
		},
		futureKey: { kept: true },
	});

	const codexBackups = backupsOf(codexConfig);
	const claudeBackups = backupsOf(claudeSettings);
	expect(codexBackups).toHaveLength(1);
	expect(claudeBackups).toHaveLength(1);
	expect(readFileSync(path.join(home, '.codex', codexBackups[0]), 'utf8')).toBe(codexOriginal);
	expect(readFileSync(path.join(home, '.claude', claudeBackups[0]), 'utf8')).toBe(claudeOriginal);
});

test('a second apply is a no-op: statuses unchanged, no new backup, and no file changes', () => {
	setup();
	const after = hashes(home);

	const again = setup();

	expect(again.agents.map((agent) => agent.status)).toEqual(['unchanged', 'unchanged']);
	expect(again.agents.every((agent) => agent.changes.length === 0 && agent.backupPath === null)).toBe(true);
	expect(again.restartRequired).toBe(false);
	expect(backupsOf(codexConfig)).toHaveLength(1);
	expect(backupsOf(claudeSettings)).toHaveLength(1);
	expect(hashes(home)).toEqual(after);
});

test('a Codex config that is not workspace-write is refused with the manual step, and neither config changes', () => {
	writeFileSync(codexConfig, CODEX_SENTINEL.replace('sandbox_mode = "workspace-write"', 'sandbox_mode = "read-only"'));
	const before = hashes(home);

	const result = cli(['setup']);

	expect(result.code).not.toBe(0);
	expect(result.stderr).toContain('sandbox_mode is "read-only"');
	expect(result.stderr).toContain('Nothing was written');
	expect(result.stderr).toContain('Manual setup: set sandbox_mode = "workspace-write"');
	expect(hashes(home)).toEqual(before);
	expect(existsSync(dataRoot)).toBe(false);
});

test('after setup, a CLI project hands out a shared folder whose TASK.md can be read, edited, and given history', () => {
	setup();
	const name = 'Home setup check';
	createProject(name);

	const workspace = JSON.parse(cliOk(['--project', name, 'workspace', '--json']).stdout) as { folder: string; tasks: string };
	expect(workspace.folder.startsWith(path.join(dataRoot, 'shared') + path.sep)).toBe(true);

	const added = JSON.parse(
		cliOk(['--project', name, 'add', 'Check the shared folder', '--assignee', 'ai', '--actor', 'human', '--desc', TASK_TEXT, '--json']).stdout,
	) as { card: { id: number } };
	const task = path.join(workspace.tasks, String(added.card.id), 'TASK.md');
	expect(readFileSync(task, 'utf8')).toContain('First body.');

	replaceFileAtomically(task, readFileSync(task, 'utf8').replace('First body.', 'Edited from the shared folder.'));
	cliOk(['--project', name, 'history', 'add', String(added.card.id), '--reason', 'Checked from the shared folder']);

	const shown = JSON.parse(cliOk(['--project', name, 'show', String(added.card.id), '--json']).stdout).card as CardJson;
	expect(shown.body).toBe('Edited from the shared folder.');
	expect(shown.acceptance).toEqual([{ id: 'AC-1', text: 'Works', done: false }]);
	const latest = shown.history.at(-1);
	expect(Object.keys(latest ?? {}).sort()).toEqual(['at', 'reason']);
	expect(latest?.reason).toBe('Checked from the shared folder');
});

test('the old OS application-support folder is never created or read by the setup and project run', () => {
	const oldArea = path.join(home, 'Library', 'Application Support', 'agboard');
	mkdirSync(oldArea, { recursive: true });
	writeFileSync(path.join(oldArea, 'marker.txt'), 'Not agboard data.\n');
	const libraryBefore = hashes(path.join(home, 'Library'));

	setup();
	const name = 'Old area check';
	createProject(name);
	const workspace = JSON.parse(cliOk(['--project', name, 'workspace', '--json']).stdout) as { folder: string };

	expect(hashes(path.join(home, 'Library'))).toEqual(libraryBefore);
	expect(workspace.folder.startsWith(dataRoot + path.sep)).toBe(true);
	expect(workspace.folder).not.toContain('Application Support');
});
