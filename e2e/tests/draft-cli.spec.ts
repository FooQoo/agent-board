import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  agboard,
  agboardBinary,
  agboardOk,
  agboardCatalogOk,
  agboardCatalog,
  listCards,
  mainHome,
  mainProject,
  makeHome,
  nextCardId,
  removeHome,
  resetBoard,
  restoreProject,
  type AgboardResult,
  type CardJson,
} from '../helpers/agboard';
import { waitForSync } from '../helpers/ui';

// What a draft means for the CLI, and the limits of a description, with the real binary and a real serve.
// The CLI never makes a draft: only the page does, so each test uses the page for that one step.

interface ShownCard extends CardJson {
  description: string;
  isDraft: boolean;
  updatedAt: string;
  history: unknown[];
}

const details = (page: Page) => page.getByRole('complementary', { name: 'Card details' });
const card = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });

function show(id: number): ShownCard {
  return JSON.parse(agboardOk(mainProject, ['show', String(id), '--json']).stdout).card;
}

/** The whole board as the CLI reports it, without the time of the report. */
function board(): string {
  const { fetchedAt, ...rest } = JSON.parse(agboardOk(mainProject, ['snapshot', '--json']).stdout);
  void fetchedAt;
  return JSON.stringify(rest);
}

async function open(page: Page, id: number): Promise<void> {
  await page.goto('/');
  await waitForSync(page);
  await card(page, id).click();
}

async function makeDraft(page: Page): Promise<void> {
  await details(page).getByRole('button', { name: 'Make draft' }).click();
  await expect(details(page).getByRole('region', { name: 'Draft' })).toBeVisible();
}

const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

let work: string;

test.beforeAll(() => {
  work = mkdtempSync(path.join(os.tmpdir(), 'agent-board-e2e-draft-'));
});
test.afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

test.beforeEach(() => {
  resetBoard(mainProject);
});

test('a draft is read-only for edit, mv, and state, and everything else still works; finalizing lifts it', async ({
  page,
}) => {
  // Card #13 is an idle Doing card of the AI, so all three writes are valid for it when it is not a draft.
  await open(page, 13);
  await makeDraft(page);
  await expect.poll(() => show(13).isDraft).toBe(true);

  const before = board();
  const refused: [string, string[]][] = [
    ['edit', ['edit', '13', '--title', 'Changed by an agent']],
    ['mv', ['mv', '13', 'done', '--actor', 'ai', '--reason', 'Finished.']],
    ['state', ['state', '13', 'running', '--actor', 'ai', '--reason', 'Resuming.']],
  ];
  for (const [name, args] of refused) {
    const result: AgboardResult = agboard(mainProject, args);
    expect(result.code, name).toBe(1);
    expect(result.stdout, name).toBe('');
    // The message is English and says what to do.
    expect(result.stderr, name).toContain('card #13 is a draft and read-only for agents.');
    expect(result.stderr, name).toContain('Wait for the user to finalize it, then try again.');
    const json = agboard(mainProject, [...args, '--json']);
    expect(json.code, name).toBe(1);
    expect(JSON.parse(json.stderr || json.stdout).error.code, name).toBe('card_is_draft');
  }
  // Nothing changed, not even the time or the history.
  expect(board()).toBe(before);

  // Reading, listing, and adding keep working, and the draft is visible in each.
  expect(show(13)).toMatchObject({ id: 13, isDraft: true });
  expect(agboardOk(mainProject, ['show', '13']).stdout).toContain('Draft: yes');
  expect(agboardOk(mainProject, ['ls']).stdout).toMatch(/#13 Check the board display \[AI\] \[draft\]/);
  expect(agboardOk(mainProject, ['ls']).stdout).not.toMatch(/#14 .*\[draft\]/);
  expect(JSON.parse(agboardOk(mainProject, ['ls', '--json']).stdout).cards.find((c: ShownCard) => c.id === 13).isDraft).toBe(true);
  expect(JSON.parse(agboardOk(mainProject, ['snapshot', '--json']).stdout).cards.find((c: ShownCard) => c.id === 13).isDraft).toBe(true);
  const added = JSON.parse(agboardOk(mainProject, ['add', 'Made while a draft exists', '--json']).stdout).card;
  expect(added).toMatchObject({ isDraft: false, cardStatus: 'todo', agentStatus: 'idle' });

  // The page and the CLI agree; a person can finalize and the agent can write again.
  await details(page).getByRole('button', { name: 'Finalize' }).click();
  await expect(details(page).getByRole('region', { name: 'Draft' })).toHaveCount(0);
  expect(show(13).isDraft).toBe(false);
  expect(agboardOk(mainProject, ['edit', '13', '--title', 'Changed by an agent']).code).toBe(0);
  agboardOk(mainProject, ['state', '13', 'running', '--actor', 'ai', '--reason', 'Resuming.']);
  agboardOk(mainProject, ['mv', '13', 'done', '--actor', 'ai', '--reason', 'Finished.']);
  expect(show(13)).toMatchObject({ title: 'Changed by an agent', cardStatus: 'done' });
});

test('a draft stays a draft over time, and toggling it wakes wait without touching the history or the update time', async ({
  page,
}) => {
  await open(page, 13);
  const first = show(13);
  const cursor = JSON.parse(agboardOk(mainProject, ['snapshot', '--json']).stdout).cursor as string;
  const env = { ...process.env, SKAN_HOME: mainHome(), TZ: 'UTC' };
  const waiter = spawn(agboardBinary(), ['--project', mainProject, '--json', 'wait', '--after', cursor, '--timeout', '30'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  waiter.stdout.on('data', (chunk) => (out += chunk));
  const ended = new Promise<number | null>((resolve) => waiter.once('exit', (code) => resolve(code)));
  try {
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(waiter.exitCode).toBeNull();
    await makeDraft(page);
    expect(await ended).toBe(0);
    const received = JSON.parse(out) as { cards: ShownCard[]; cursor: string };
    expect(received.cards.find((c) => c.id === 13)).toMatchObject({ isDraft: true });
    expect(received.cursor).not.toBe(cursor);
  } finally {
    waiter.kill();
  }
  const drafted = show(13);
  expect(drafted.updatedAt).toBe(first.updatedAt);
  expect(drafted.history).toEqual(first.history);

  // It does not clear by itself.
  await new Promise((resolve) => setTimeout(resolve, 3000));
  expect(show(13).isDraft).toBe(true);

  // Finalizing is a change too: wait wakes, and the history and update time are still the same.
  const cursor2 = JSON.parse(agboardOk(mainProject, ['snapshot', '--json']).stdout).cursor as string;
  const second = spawnSyncWait(cursor2);
  await details(page).getByRole('button', { name: 'Finalize' }).click();
  expect((await second).code).toBe(0);
  const finalized = show(13);
  expect(finalized).toMatchObject({ isDraft: false, updatedAt: first.updatedAt });
  expect(finalized.history).toEqual(first.history);
});

function spawnSyncWait(cursor: string): Promise<{ code: number | null }> {
  const child = spawn(agboardBinary(), ['--project', mainProject, '--json', 'wait', '--after', cursor, '--timeout', '30'], {
    env: { ...process.env, SKAN_HOME: mainHome(), TZ: 'UTC' },
    stdio: 'ignore',
  });
  return new Promise((resolve) => child.once('exit', (code) => resolve({ code })));
}

test('add, edit, and import accept 50,000 characters and refuse one more, with CRLF turned into LF', async () => {
  const exact = 'あ'.repeat(50_000);
  const over = 'あ'.repeat(50_001);
  const exactFile = path.join(work, 'exact.md');
  const overFile = path.join(work, 'over.md');
  writeFileSync(exactFile, exact);
  writeFileSync(overFile, over);

  const id = nextCardId(mainProject);
  agboardOk(mainProject, ['add', 'Exact limit', '--desc-file', exactFile]);
  expect(show(id).description).toBe(exact);
  const stdin = spawnSync(agboardBinary(), ['--project', mainProject, 'add', 'From stdin', '--desc', '-', '--assignee', 'ai', '--actor', 'ai'], {
    env: { ...process.env, SKAN_HOME: mainHome(), TZ: 'UTC' },
    input: exact,
    encoding: 'utf8',
  });
  expect(stdin.status).toBe(0);
  expect(show(id + 1).description).toBe(exact);

  // One more is refused with the count and the limit, and nothing is stored.
  const before = board();
  for (const args of [
    ['add', 'Too long', '--desc-file', overFile],
    ['edit', String(id), '--desc-file', overFile],
  ]) {
    const result = agboard(mainProject, args);
    expect(result.code, args.join(' ')).toBe(2);
    expect(result.stderr).toContain('Descriptions must be 50,000 characters or fewer. This one has 50001.');
  }
  expect(board()).toBe(before);

  // CRLF is stored as LF (a file's last line ending is dropped, as before).
  const crlfFile = path.join(work, 'crlf.md');
  writeFileSync(crlfFile, 'line one\r\nline two\r\n');
  agboardOk(mainProject, ['edit', String(id), '--desc-file', crlfFile]);
  expect(show(id).description).toBe('line one\nline two');
  agboardOk(mainProject, ['edit', String(id), '--desc', 'first\r\nsecond\r\n']);
  expect(show(id).description).toBe('first\nsecond\n');

  // A backup with a description over the limit is refused as a whole.
  const exported = path.join(work, 'export.json');
  agboardOk(mainProject, ['export', '-o', exported]);
  const backup = JSON.parse(readFileSync(exported, 'utf8'));
  backup.cards[0].description = over;
  const tooBig = path.join(work, 'too-big.json');
  writeFileSync(tooBig, JSON.stringify(backup));
  const refused = agboard(mainProject, ['--json', 'import', tooBig]);
  expect(refused.code).not.toBe(0);
  expect(listCards(mainProject).length).toBe(JSON.parse(readFileSync(exported, 'utf8')).cards.length);
});

test('export keeps isDraft through a round trip, and a backup from before drafts comes back with no drafts', async ({
  page,
}) => {
  // The fixture was made before drafts existed; it has no isDraft at all, and every card comes back a non-draft.
  expect(listCards(mainProject).length).toBe(8);
  expect(JSON.parse(readFileSync(path.resolve(import.meta.dirname, '..', 'fixtures', 'agent-board.json'), 'utf8')).cards[0]).not.toHaveProperty('isDraft');
  for (const item of listCards(mainProject)) expect(show(item.id).isDraft, `#${item.id}`).toBe(false);

  await open(page, 13);
  await makeDraft(page);
  const exported = path.join(work, 'draft-export.json');
  agboardOk(mainProject, ['export', '-o', exported]);
  const backup = JSON.parse(readFileSync(exported, 'utf8'));
  expect(backup.version).toBe(2);
  expect(backup.cards.find((c: { id: number }) => c.id === 13).isDraft).toBe(true);
  expect(backup.cards.filter((c: { isDraft: boolean }) => c.isDraft)).toHaveLength(1);

  // Back to the old backup, then the new one: the draft returns exactly as it left.
  resetBoard(mainProject);
  expect(show(13).isDraft).toBe(false);
  restoreProject(mainProject, exported);
  expect(show(13).isDraft).toBe(true);
  for (const item of listCards(mainProject)) {
    if (item.id !== 13) expect(show(item.id).isDraft, `#${item.id}`).toBe(false);
  }
  const again = path.join(work, 'draft-export-2.json');
  agboardOk(mainProject, ['export', '-o', again]);
  expect(JSON.parse(readFileSync(again, 'utf8')).cards.find((c: { id: number }) => c.id === 13).isDraft).toBe(true);
});

test('the hook hands over the whole description and isDraft; a snapshot over 256 KiB is reported, not cut', async () => {
  const body = '## Section\n' + 'あいうえお'.repeat(8_000);
  const bodyFile = path.join(work, 'hook.md');
  writeFileSync(bodyFile, body);
  const id = nextCardId(mainProject);
  agboardOk(mainProject, ['add', 'Long hook card', '--desc-file', bodyFile]);

  const hook = () =>
    spawnSync(agboardBinary(), ['--project', mainProject, 'hook', '--agent', 'claude'], {
      env: { ...process.env, SKAN_HOME: mainHome(), TZ: 'UTC' },
      encoding: 'utf8',
      input: JSON.stringify({ hook_event_name: 'PostToolUse' }),
    });
  const first = hook();
  expect(first.status).toBe(0);
  const context = (JSON.parse(first.stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput
    .additionalContext;
  expect(Buffer.byteLength(context)).toBeLessThanOrEqual(256 * 1024);
  expect(context.startsWith('AGBOARD_SNAPSHOT\n')).toBe(true);
  const snapshot = JSON.parse(context.slice('AGBOARD_SNAPSHOT\n'.length)) as { cards: ShownCard[] };
  const handed = snapshot.cards.find((c) => c.id === id)!;
  expect(handed.description).toBe(body);
  expect(handed.isDraft).toBe(false);

  // Enough big cards to pass the limit: the hook says it could not get the snapshot, with no part of it.
  const huge = path.join(work, 'huge.md');
  writeFileSync(huge, 'あ'.repeat(50_000));
  agboardOk(mainProject, ['add', 'Huge one', '--desc-file', huge]);
  agboardOk(mainProject, ['add', 'Huge two', '--desc-file', huge]);
  const over = hook();
  expect(over.status).toBe(0);
  const overContext = (JSON.parse(over.stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput
    .additionalContext;
  expect(overContext.startsWith('AGBOARD_ERROR\n')).toBe(true);
  expect(overContext).toContain('context_too_large');
  expect(overContext).not.toContain('AGBOARD_SNAPSHOT');
  expect(overContext).not.toContain('あ');
  expect(Buffer.byteLength(overContext)).toBeLessThan(2_000);
});

test('a new data area is version 4 with is_draft, and older versions are refused without a change', async () => {
  const home = makeHome('schema');
  const copy = makeHome('schema-old');
  try {
    agboardCatalogOk(['project', 'create', 'Fresh'], home);
    const db = path.join(home, 'board.db');
    const sqlite = (file: string, sql: string) =>
      spawnSync('sqlite3', [file, sql], { encoding: 'utf8' }).stdout.trim();
    expect(sqlite(db, 'PRAGMA user_version')).toBe('4');
    expect(sqlite(db, "SELECT count(*) FROM pragma_table_info('cards') WHERE name = 'is_draft'")).toBe('1');

    // The same database claiming version 3, then an unknown version: both are refused as they are.
    for (const version of [3, 2, 99]) {
      agboardOk('Fresh', ['add', `Card for ${version}`], home);
      const target = path.join(copy, 'board.db');
      spawnSync('sqlite3', [db, 'PRAGMA wal_checkpoint(TRUNCATE)']);
      copyFileSync(db, target);
      sqlite(target, `PRAGMA user_version = ${version}`);
      const before = sha(target);
      const refused = spawnSync(agboardBinary(), ['--project', 'Fresh', 'ls'], {
        env: { ...process.env, SKAN_HOME: copy, TZ: 'UTC' },
        encoding: 'utf8',
      });
      expect(refused.status, `version ${version}`).toBe(1);
      expect(refused.stderr).toContain('cannot open the board');
      expect(refused.stdout).toBe('');
      const json = spawnSync(agboardBinary(), ['project', 'ls', '--json'], {
        env: { ...process.env, SKAN_HOME: copy, TZ: 'UTC' },
        encoding: 'utf8',
      });
      expect(JSON.parse(json.stderr || json.stdout).error.code, `version ${version}`).toBe('database_error');
      expect(sha(target), `version ${version}`).toBe(before);
      expect(sqlite(target, 'PRAGMA user_version')).toBe(String(version));
    }
  } finally {
    removeHome(home);
    removeHome(copy);
  }
});

test('the help explains Markdown descriptions and what a refused write to a draft means', async () => {
  const general = agboardCatalog(['--help']);
  expect(general.code).toBe(0);
  expect(general.stdout).toContain('Markdown');
  expect(general.stdout).toContain('50,000');
  expect(general.stdout).toContain('isDraft');
  expect(general.stdout).toContain('card_is_draft');
  for (const command of ['add', 'edit']) {
    const help = agboardCatalog([command, '--help']);
    expect(help.stdout, command).toContain('Markdown');
    expect(help.stdout, command).toContain('50,000');
  }
});
