import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { agboardOk, mainProject, nextTaskId, resetBoard } from '../helpers/agboard';
import { startImageServer, type ImageServer } from '../helpers/imageServer';
import { readBoardAfterReset, waitForSync } from '../helpers/ui';

// Opening a task reads its text, conditions, log and epic once, so every tab shows at once. A status
// change reads the Summary and the history again but not the text. The drawer holds the stream back
// while it is open and for 3 seconds after, while a save or an answer shows at once.

const details = (page: Page) => page.getByRole('complementary', { name: 'Task details' });
const lane = (page: Page, name: string) => page.getByRole('region', { name });
const task = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });
const request = (page: Page, id = 12) => page.locator(`.card__answer[data-task-id="${id}"]`);

interface Seen {
  path: string;
  query: string;
}

/** Every request the page makes to the Summary and Detail routes, in order. */
function watch(page: Page): Seen[] {
  const seen: Seen[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (/\/(summary|detail)$/.test(url.pathname)) seen.push({ path: url.pathname, query: url.search });
  });
  return seen;
}
const summaries = (seen: Seen[]) => seen.filter((r) => r.path.endsWith('/summary'));
const sectionReads = (seen: Seen[], id: number, section: 'document' | 'history') =>
  seen.filter((r) => r.path.endsWith(`/tasks/${id}/detail`) && r.query.includes(section));

let images: ImageServer;
let work: string;

test.beforeAll(async () => {
  images = await startImageServer(9281);
  work = mkdtempSync(path.join(os.tmpdir(), 'agent-board-e2e-pc-'));
});

test.afterAll(async () => {
  await images?.close();
  if (work) rmSync(work, { recursive: true, force: true });
});

test.beforeEach(async ({ page }) => {
  resetBoard(mainProject);
  await page.goto('/');
  await waitForSync(page);
  await readBoardAfterReset(page);
});

test('a status change reads the Summary and the history again, and the document is not read again', async ({ page }) => {
  const seen = watch(page);
  await task(page, 16).click();
  await expect(details(page).getByRole('heading', { level: 2 })).toHaveText('Refine the empty board');
  // Only the tab that is shown is read: the description needs the document and nothing else.
  await expect.poll(() => sectionReads(seen, 16, 'document').length).toBe(1);
  expect(sectionReads(seen, 16, 'history')).toHaveLength(0);

  await details(page).getByRole('tab', { name: /^History/ }).click();
  await expect(details(page).getByRole('tabpanel').getByRole('listitem').first()).toBeVisible();
  expect(sectionReads(seen, 16, 'history')).toHaveLength(1);
  const before = {
    summaries: summaries(seen).length,
    documents: sectionReads(seen, 16, 'document').length,
    histories: sectionReads(seen, 16, 'history').length,
  };

  // The drawer is open, so the page asks for the board itself instead of waiting for the stream.
  agboardOk(mainProject, ['mv', '16', 'doing', '--actor', 'ai', '--reason', 'Started the work.']);
  await readBoardAfterReset(page);
  await expect(lane(page, 'Doing').getByRole('button', { name: /^#16 / })).toBeVisible();
  await expect(details(page).getByRole('tabpanel').getByRole('listitem').first()).toContainText('Started the work.');
  await expect(details(page).getByRole('tab', { name: /^History [0-9]+$/ })).toBeVisible();

  expect(summaries(seen).length).toBeGreaterThan(before.summaries);
  expect(sectionReads(seen, 16, 'history').length).toBeGreaterThan(before.histories);
  expect(sectionReads(seen, 16, 'document')).toHaveLength(before.documents);

  // Back on the description: the document read before is shown again without a new read.
  await details(page).getByRole('tab', { name: 'Description' }).click();
  await expect(details(page).getByRole('tabpanel')).not.toBeEmpty();
  expect(sectionReads(seen, 16, 'document')).toHaveLength(before.documents);
});

test('a task nobody opened is not read, and opening a task reads its epic once, for every task of that epic', async ({ page }) => {
  const seen = watch(page);
  await expect(lane(page, 'Todo').getByRole('button').first()).toBeVisible();
  expect(seen.filter((r) => r.path.includes('/detail'))).toEqual([]);

  // Task 12 belongs to no epic in the seed; give a task one through the CLI and show it after a refresh.
  const id = nextTaskId(mainProject);
  const plan = path.join(work, 'plan.md');
  writeFileSync(plan, 'The epic plan.');
  agboardOk(mainProject, ['epic', 'add', 'TEST-EPIC', '--name', 'Test epic', '--color', '#2563EB', '--actor', 'human']);
  agboardOk(mainProject, ['epic', 'edit', 'TEST-EPIC', '--document-file', plan]);
  agboardOk(mainProject, ['add', 'In an epic', '--desc', 'Body.', '--epic', 'TEST-EPIC']);
  await readBoardAfterReset(page);
  await task(page, id).click();
  await expect(details(page).getByRole('tabpanel')).toContainText('Body.');
  expect(seen.filter((r) => r.path.includes('/epics/'))).toEqual([]);

  await details(page).getByRole('tab', { name: /^Epic/ }).click();
  await expect(details(page).getByRole('tabpanel')).toContainText('The epic plan.');
  const epicReads = () => seen.filter((r) => r.path.includes('/epics/TEST-EPIC/detail')).length;
  expect(epicReads()).toBe(1);

  // Another tab and back, and the same epic from a second task: no new read.
  await details(page).getByRole('tab', { name: 'Description' }).click();
  await details(page).getByRole('tab', { name: /^Epic/ }).click();
  await expect(details(page).getByRole('tabpanel')).toContainText('The epic plan.');
  expect(epicReads()).toBe(1);
});

test('the drawer holds updates while it is open and for 3 seconds after; a save and an answer show at once', async ({ page }) => {
  await task(page, 8).click();
  await expect(details(page).getByRole('heading', { level: 2 })).toHaveText('Initialize the board');

  // A change from the CLI does not reach the board while the drawer is open.
  agboardOk(mainProject, ['mv', '16', 'doing']);
  await page.waitForTimeout(1500);
  await expect(lane(page, 'Todo').getByRole('button', { name: /^#16 / })).toBeVisible();
  await expect(lane(page, 'Doing').getByRole('button', { name: /^#16 / })).toHaveCount(0);

  // A save made here shows at once, with the drawer still open: the card is a draft on its tile.
  await task(page, 14).click();
  await details(page).getByRole('button', { name: 'Make draft' }).click();
  await expect(task(page, 14).getByText('Draft', { exact: true })).toHaveCount(1, { timeout: 2_000 });

  // An answer shows at once, too: the request is gone and the card is idle.
  await expect(request(page)).toBeVisible();
  await request(page).getByRole('textbox', { name: 'Your answer' }).fill('Keep the current name.');
  await request(page).getByRole('button', { name: 'Send', exact: true }).click();
  await expect(request(page)).toHaveCount(0, { timeout: 2_000 });
  await expect(lane(page, 'Doing').getByRole('button', { name: /^#12 AI Idle / })).toBeVisible({ timeout: 2_000 });

  // A change from the CLI made now is held until the drawer has been closed for 3 seconds.
  agboardOk(mainProject, ['mv', '15', 'doing']);
  await page.waitForTimeout(1000);
  await expect(lane(page, 'Doing').getByRole('button', { name: /^#15 / })).toHaveCount(0);
  await details(page).getByRole('button', { name: 'Close details' }).click();
  await page.waitForTimeout(1500);
  await expect(lane(page, 'Doing').getByRole('button', { name: /^#15 / })).toHaveCount(0);
  // After the wait it is shown, with no reload.
  await expect(lane(page, 'Doing').getByRole('button', { name: /^#15 / })).toBeVisible({ timeout: 5_000 });
});

/** A document near the 50,000-character limit with GFM, lists, code, Mermaid and an image. */
function bigDocument(origin: string): string {
  const head = [
    'Intro paragraph of the long document.',
    '',
    `![sample picture](${origin}/ok.png)`,
    '',
    '```mermaid',
    'flowchart TD',
    '  Start --> Finish',
    '```',
    '',
  ].join('\n');
  const section = (n: number) =>
    `## Section ${n}\n\nText ${n}.\n\n- a${n}\n- b${n}\n\n| x | y |\n|---|---|\n| ${n} | ${n} |\n\n\`\`\`\ncode ${n}\n\`\`\`\n\n`;
  let text = head;
  let n = 1;
  while (text.length + section(n).length < 49_900) text += section(n++);
  return `${text}Last line of the document.`;
}

test('a 50,000-character document is shown with a bounded page, and is edited and saved as before', async ({ page }) => {
  const id = nextTaskId(mainProject);
  const file = path.join(work, 'big.md');
  const text = bigDocument(images.origin);
  expect(text.length).toBeGreaterThan(49_000);
  expect(text.length).toBeLessThanOrEqual(50_000);
  writeFileSync(file, text);
  agboardOk(mainProject, ['add', 'Big document', '--desc-file', file]);
  await readBoardAfterReset(page);

  await task(page, id).click();
  const panel = details(page).getByRole('tabpanel');
  await expect(panel.getByText('Intro paragraph of the long document.')).toBeVisible();
  await expect(panel.getByRole('img', { name: 'sample picture' })).toBeVisible();
  await expect.poll(() => panel.getByRole('img', { name: 'sample picture' }).evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  // The diagram near the top is drawn.
  await expect(panel.locator('.md-mermaid__svg svg').first()).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByRole('heading', { name: 'Section 1', exact: true })).toBeVisible();
  await expect(panel.getByRole('table').first()).toBeVisible();

  // Only the blocks near the viewport are in the page: the drawer stays small, and the end is not there yet.
  const nodes = await details(page).evaluate((element) => element.querySelectorAll('*').length);
  expect(nodes).toBeLessThan(3_000);
  await expect(panel.getByText('Last line of the document.')).toHaveCount(0);
  // Scrolling to the end brings the end in.
  await panel.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(panel.getByText('Last line of the document.')).toBeVisible({ timeout: 20_000 });

  // Edit and save: the dialog opens from the whole text, and a later save wins over an earlier one.
  await details(page).getByRole('button', { name: 'Make draft' }).click();
  await expect(details(page).getByRole('region', { name: 'Draft' })).toBeVisible();
  await details(page).getByRole('button', { name: 'Edit task' }).click();
  const dialog = page.getByRole('dialog', { name: new RegExp(`^#${id} Edit task`) });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(new RegExp(`^${text.length.toLocaleString('en-US')} / 50,000`))).toBeVisible({ timeout: 30_000 });

  // A second page saves a title first.
  const second = await page.context().newPage();
  await second.goto('/');
  await waitForSync(second);
  await task(second, id).click();
  await details(second).getByRole('button', { name: 'Edit task' }).click();
  const secondDialog = second.getByRole('dialog', { name: new RegExp(`^#${id} Edit task`) });
  await secondDialog.getByRole('textbox', { name: 'Title', exact: true }).fill('Saved from the second page');
  await secondDialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(secondDialog).toHaveCount(0);
  await expect.poll(() => JSON.parse(agboardOk(mainProject, ['show', String(id), '--json']).stdout).task.title).toBe('Saved from the second page');
  await second.close();

  // The first page saves later, from what it opened with: its title is the one that stays, and the text is kept whole.
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill('Saved from the first page');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(() => JSON.parse(agboardOk(mainProject, ['show', String(id), '--json']).stdout).task.title).toBe('Saved from the first page');
  const stored = JSON.parse(agboardOk(mainProject, ['show', String(id), '--json']).stdout).task;
  expect(stored.body.trim()).toBe(text.trim());
  expect(stored.isDraft).toBe(true);
});
