import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  agboard,
  agboardBinary,
  agboardCatalog,
  agboardCatalogOk,
  agboardOk,
  listCards,
  mainHome,
  mainProject,
  makeHome,
  nextCardId,
  removeHome,
  resetBoard,
  cardBody,
  workspace,
  type AgboardResult,
  type CardJson,
} from '../helpers/agboard';
import { waitForSync } from '../helpers/ui';

// What a draft means for the CLI, and the limits of a body, with the real binary and a real serve.
// The CLI never makes a draft: only the page does, so each test uses the page for that one step.

interface ShownCard extends CardJson {
  description: string;
  isDraft: boolean;
  updatedAt: string;
  history: { kind: string; actor: string; at: string }[];
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

/** A body of exactly `count` characters as the CLI counts them: the text alone, with no surrounding template. */
function bodyOfLength(count: number): string {
  return cardBody('あ'.repeat(count));
}

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

test('a draft stays a draft over time, and toggling it wakes wait; the toggle is recorded but the update time is not moved', async ({
  page,
}) => {
  await open(page, 13);
  const first = show(13);
  const cursor = JSON.parse(agboardOk(mainProject, ['snapshot', '--json']).stdout).cursor as string;
  const env = { ...process.env, AGBOARD_HOME: mainHome(), TZ: 'UTC' };
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
  // The change is a history event of kind draft; the update time stays as it was.
  expect(drafted.updatedAt).toBe(first.updatedAt);
  expect(drafted.history).toHaveLength(first.history.length + 1);
  expect(drafted.history.at(-1)).toMatchObject({ kind: 'draft', actor: 'human' });

  // It does not clear by itself.
  await new Promise((resolve) => setTimeout(resolve, 3000));
  expect(show(13).isDraft).toBe(true);

  // Finalizing is a change too: wait wakes, and it adds one more history event with the same update time.
  const cursor2 = JSON.parse(agboardOk(mainProject, ['snapshot', '--json']).stdout).cursor as string;
  const second = spawnSyncWait(cursor2);
  await details(page).getByRole('button', { name: 'Finalize' }).click();
  expect((await second).code).toBe(0);
  const finalized = show(13);
  expect(finalized).toMatchObject({ isDraft: false, updatedAt: first.updatedAt });
  expect(finalized.history).toHaveLength(drafted.history.length + 1);
  expect(finalized.history.at(-1)).toMatchObject({ kind: 'draft', actor: 'human' });
});

function spawnSyncWait(cursor: string): Promise<{ code: number | null }> {
  const child = spawn(agboardBinary(), ['--project', mainProject, '--json', 'wait', '--after', cursor, '--timeout', '30'], {
    env: { ...process.env, AGBOARD_HOME: mainHome(), TZ: 'UTC' },
    stdio: 'ignore',
  });
  return new Promise((resolve) => child.once('exit', (code) => resolve({ code })));
}

test('a body of exactly 50,000 characters is accepted for add, edit, and --desc -, and one more is refused with nothing stored', async () => {
  const exact = bodyOfLength(50_000);
  const over = bodyOfLength(50_001);
  const exactFile = path.join(work, 'exact.md');
  const overFile = path.join(work, 'over.md');
  writeFileSync(exactFile, exact);
  writeFileSync(overFile, over);

  const id = nextCardId(mainProject);
  agboardOk(mainProject, ['add', 'Exact limit', '--desc-file', exactFile]);
  expect([...show(id).description].length).toBe(50_000);
  const stdin = spawnSync(agboardBinary(), ['--project', mainProject, 'add', 'From stdin', '--desc', '-', '--assignee', 'ai', '--actor', 'ai'], {
    env: { ...process.env, AGBOARD_HOME: mainHome(), TZ: 'UTC' },
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

  // CRLF is stored as LF.
  const crlfFile = path.join(work, 'crlf.md');
  writeFileSync(crlfFile, cardBody('line one\nline two').replace(/\n/g, '\r\n'));
  agboardOk(mainProject, ['edit', String(id), '--desc-file', crlfFile]);
  expect(show(id).description).not.toContain('\r');
  expect(show(id).description).toContain('line one\nline two');
});

test('a backup is a copy of the project folder; copying it back brings a draft back exactly as it left', async ({ page }) => {
  // The fixture has no drafts; every card comes back a non-draft.
  expect(listCards(mainProject).length).toBe(8);
  for (const item of listCards(mainProject)) expect(show(item.id).isDraft, `#${item.id}`).toBe(false);

  await open(page, 13);
  await makeDraft(page);
  await expect.poll(() => show(13).isDraft).toBe(true);

  // The backup copies the card and epic files of the project (MODEL.md, backups).
  const folder = workspace(mainProject).folder;
  const backup = path.join(work, 'folder-backup');
  for (const part of ['tasks', 'epics', 'project.json']) {
    if (existsSync(path.join(folder, part))) cpSync(path.join(folder, part), path.join(backup, part), { recursive: true });
  }
  expect(readFileSync(path.join(backup, 'tasks', '13', 'task.json'), 'utf8')).toContain('"isDraft": true');

  // Back to the seeded board, then the backup: the draft returns exactly as it left.
  resetBoard(mainProject);
  expect(show(13).isDraft).toBe(false);
  for (const part of ['tasks', 'epics', 'project.json']) {
    rmSync(path.join(folder, part), { recursive: true, force: true });
    if (existsSync(path.join(backup, part))) cpSync(path.join(backup, part), path.join(folder, part), { recursive: true });
  }
  expect(show(13).isDraft).toBe(true);
  for (const item of listCards(mainProject)) {
    if (item.id !== 13) expect(show(item.id).isDraft, `#${item.id}`).toBe(false);
  }
});

test('the hook hands over the whole body and isDraft; a snapshot over 256 KiB is reported, not cut', async () => {
  const body = cardBody(`## Section\n${'あいうえお'.repeat(8_000)}`);
  const bodyFile = path.join(work, 'hook.md');
  writeFileSync(bodyFile, body);
  const id = nextCardId(mainProject);
  agboardOk(mainProject, ['add', 'Long hook card', '--desc-file', bodyFile]);

  const hook = () =>
    spawnSync(agboardBinary(), ['--project', mainProject, 'hook', '--agent', 'claude'], {
      env: { ...process.env, AGBOARD_HOME: mainHome(), TZ: 'UTC' },
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
  // The whole body comes back, not a cut: the section text is there and the length is the body's.
  expect(handed.description).toContain('## Section');
  expect([...handed.description].length).toBeGreaterThan(40_000);
  expect(handed.isDraft).toBe(false);

  // Enough big cards to pass the limit: the hook says it could not get the snapshot, with no part of it.
  const huge = path.join(work, 'huge.md');
  writeFileSync(huge, bodyOfLength(49_000));
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
