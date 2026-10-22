import { expectHistoryNote } from '../helpers/history';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { agboard, agboardOk, mainProject, projectId, resetBoard, taskBody, workspace, type TaskJson, decisionJson } from '../helpers/agboard';
import { readBoardAfterReset, refreshUntil, waitForSync } from '../helpers/ui';

// The task body on the real page: its sections and pictures, the answer to a decision request in three ways, a
// card that is Done and still takes an edit, and the edit dialog that saves once and rewrites nothing unless asked.

interface ShownTask extends TaskJson {
  description: string;
  isDraft: boolean;
  history: { at: string; reason: string }[];
}

const details = (page: Page) => page.getByRole('complementary', { name: 'Task details' });
const task = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });
const body = (dialog: Locator) => dialog.getByRole('textbox', { name: 'Description (Markdown)' });
const request = (page: Page, id: number) =>
  page.locator(`.card__answer[data-task-id="${id}"]`).getByRole('region', { name: 'The agent is waiting for your answer' });

function show(id: number): ShownTask {
  return JSON.parse(agboardOk(mainProject, ['show', String(id), '--json']).stdout).task;
}

async function openBoard(page: Page): Promise<void> {
  await page.goto(`/?project=${projectId(mainProject)}`);
  await waitForSync(page);
  // The server notices a file the CLI wrote 200 ms later: read the board again before a card is opened.
  await readBoardAfterReset(page);
}

/** A decision request on card `id`, the card moved to Doing and running first, as an agent does. */
function askWithChoices(id: number, question: string, choices: { id: string; label: string }[]): void {
  if (show(id).taskStatus !== 'doing') agboardOk(mainProject, ['mv', String(id), 'doing', '--actor', 'human', '--reason', 'Doing it.']);
  agboardOk(mainProject, ['state', String(id), 'running', '--actor', 'ai', '--reason', 'Working.']);
  const file = path.join(work, `request-${id}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify({ question, choices }));
  agboardOk(mainProject, ['state', String(id), 'pending', '--actor', 'ai', '--no-wait', '--request-json', readFileSync(file, 'utf8')]);
}

function askText(id: number, question: string): void {
  agboardOk(mainProject, ['state', String(id), 'running', '--actor', 'ai', '--reason', 'Working.']);
  agboardOk(mainProject, ['state', String(id), 'pending', '--actor', 'ai', '--no-wait', '--request-json', decisionJson(question)]);
}

let work: string;
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==',
  'base64',
);

test.beforeAll(() => {
  work = mkdtempSync(path.join(os.tmpdir(), 'agent-board-e2e-body-'));
});
test.afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});
test.beforeEach(() => {
  resetBoard(mainProject);
});

test('a task body shows its sections, consecutive captures side by side, and a Mermaid diagram that enlarges', async ({ page }) => {
  const one = path.join(work, 'one.png');
  const two = path.join(work, 'two.png');
  writeFileSync(one, png);
  writeFileSync(two, png);
  const first = JSON.parse(agboardOk(mainProject, ['attachment', 'add', '13', '--file', one, '--actor', 'ai', '--json']).stdout);
  const second = JSON.parse(agboardOk(mainProject, ['attachment', 'add', '13', '--file', two, '--actor', 'ai', '--json']).stdout);
  const ids = [first, second].map((item) => (item.attachment?.id ?? item.id) as string);
  const markdown = [
    '## Work',
    '',
    `![one](attachment:${ids[0]})`,
    `![two](attachment:${ids[1]})`,
    '',
    '```mermaid',
    'graph TD; A-->B;',
    '```',
    '',
  ].join('\n');
  agboardOk(mainProject, ['edit', '13', '--desc-file', writeBody(markdown)]);

  await openBoard(page);
  await task(page, 13).click();
  const panel = details(page);
  // The body is written as numbered chapters; the captures sit in one group, side by side.
  await expect(panel.getByRole('heading', { name: 'Work', level: 3 })).toBeVisible();
  const group = panel.locator('.md-captures').first();
  await expect(group.locator('.md__image-open')).toHaveCount(2);
  const boxes = await group.locator('.md__image-open').evaluateAll((items) => items.map((item) => item.getBoundingClientRect().top));
  expect(Math.abs(boxes[0] - boxes[1])).toBeLessThan(2);
  await expect
    .poll(() => group.locator('.md__image-picture').first().evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(1);

  // A capture enlarges on a press and closes with Escape.
  await group.getByRole('button', { name: 'Enlarge one' }).click();
  await expect(page.locator('.lightbox').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.lightbox')).toHaveCount(0);

  // The Mermaid diagram draws as a figure and enlarges on a press.
  const diagram = panel.locator('figure.md-mermaid');
  await expect(diagram).toBeVisible();
  await expect(diagram.locator('svg')).toHaveCount(1);
  await diagram.getByRole('button', { name: 'Enlarge diagram' }).click();
  await expect(page.locator('.lightbox__diagram')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.lightbox__diagram')).toHaveCount(0);
});

test('a decision request is answered with a choice only, with text only, or with both; two empty answers cannot be sent', async ({ page }) => {
  const choices = [
    { id: 'proceed', label: 'Proceed' },
    { id: 'stop', label: 'Stop' },
  ];
  await openBoard(page);

  // A choice alone.
  askWithChoices(16, 'Which way?', choices);
  await readBoardAfterReset(page);
  await task(page, 16).click();
  const answer = request(page, 16);
  await expect(answer.getByRole('radiogroup', { name: 'Choices' })).toBeVisible();
  const send = answer.getByRole('button', { name: 'Send', exact: true });
  await expect(send).toBeDisabled();
  await answer.getByRole('radio', { name: 'Proceed' }).check();
  await expect(send).toBeEnabled();
  await send.click();
  await expect(request(page, 16)).toHaveCount(0);
  expect(show(16)).toMatchObject({ agentStatus: 'idle' });
  expectHistoryNote(show(16).history.at(-1), ['Which way?', 'Proceed']);

  // Text alone, with no choice.
  // The open drawer holds the stream's updates back, so the board is read again by hand.
  askText(16, 'What name?');
  await refreshUntil(page, () => expect(request(page, 16)).toContainText('What name?', { timeout: 1_000 }));
  await request(page, 16).getByRole('textbox', { name: 'Your answer' }).fill('Keep the old name.');
  await request(page, 16).getByRole('button', { name: 'Send', exact: true }).click();
  await expect(request(page, 16)).toHaveCount(0);
  expectHistoryNote(show(16).history.at(-1), ['What name?', 'Keep the old name.']);
  expect(show(16).history.at(-1)).not.toHaveProperty('choiceId');

  // A choice and a note together.
  askWithChoices(16, 'Which way now?', choices);
  await refreshUntil(page, () => expect(request(page, 16).getByRole('radio', { name: 'Stop' })).toBeVisible({ timeout: 1_000 }));
  await request(page, 16).getByRole('radio', { name: 'Stop' }).check();
  await request(page, 16).getByRole('textbox', { name: 'Your answer' }).fill('Stop after the backup.');
  await request(page, 16).getByRole('button', { name: 'Send', exact: true }).click();
  await expect(request(page, 16)).toHaveCount(0);
  expectHistoryNote(show(16).history.at(-1), ['Which way now?', 'Stop', 'Stop after the backup.']);
});

test('an answer with nothing chosen and nothing typed cannot be sent', async ({ page }) => {
  askWithChoices(15, 'Ready?', [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }]);
  await openBoard(page);
  await task(page, 15).click();
  const send = request(page, 15).getByRole('button', { name: 'Send', exact: true });
  await expect(send).toBeDisabled();
  await request(page, 15).getByRole('textbox', { name: 'Your answer' }).fill('   ');
  await expect(send).toBeDisabled();
  await request(page, 15).getByRole('radio', { name: 'Yes' }).check();
  await expect(send).toBeEnabled();
});

test('a Done task rejects agent edits while a person can still edit and show its body', async ({ page }) => {
  await openBoard(page);
  // The agent reports the work: the card stays in Doing, idle.
  agboardOk(mainProject, ['state', '13', 'running', '--actor', 'ai', '--reason', 'Working.']);
  agboardOk(mainProject, ['state', '13', 'idle', '--actor', 'ai', '--reason', 'Reported as finished.']);
  expect(show(13)).toMatchObject({ taskStatus: 'doing', agentStatus: 'idle' });
  await expect(page.getByRole('region', { name: 'Doing' }).getByRole('button', { name: /^#13(?!\d)/ })).toBeVisible();

  // The coordinator moves it to Done with a reason.
  agboardOk(mainProject, ['mv', '13', 'done', '--actor', 'human', '--reason', 'Accepted.']);
  await expect(page.getByRole('region', { name: 'Done' }).getByRole('button', { name: /^#13(?!\d)/ })).toBeVisible();

  // Done is read-only for agents. A human can still edit it in the page below.
  const refused = agboard(mainProject, ['edit', '13', '--desc-file', writeBody(taskBody('Corrected after Done.'))]);
  expect(refused.code).not.toBe(0);
  expect(refused.stderr).toContain('task #13 is done and read-only for agents');
  expect(show(13)).toMatchObject({ taskStatus: 'done', agentStatus: 'idle' });
  await task(page, 13).click();
  await expect(details(page)).toContainText('Check the layout at 1280, 800, and 480 px.');
  await expect(details(page)).toContainText('Done');

  // Human editing in the page remains available: make a draft, edit the body, and save it while Done.
  await details(page).getByRole('button', { name: 'Make draft' }).click();
  await details(page).getByRole('button', { name: 'Edit task' }).click();
  const dialog = page.getByRole('dialog', { name: /^#13 / });
  await expect(body(dialog).getByText('Check the layout at 1280, 800, and 480 px.')).toBeVisible();
  await body(dialog).getByText('Check the layout at 1280, 800, and 480 px.').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Second line after Done.');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(show(13)).toMatchObject({ taskStatus: 'done', isDraft: true });
  expect(show(13).description).toContain('Second line after Done.');
});

test('the edit dialog writes nothing when it is opened and closed unchanged, and saves its text and pictures once when changed', async ({ page }) => {
  const picture = path.join(work, 'keep.png');
  writeFileSync(picture, png);
  const added = JSON.parse(agboardOk(mainProject, ['attachment', 'add', '15', '--file', picture, '--actor', 'ai', '--json']).stdout);
  const pictureId = (added.attachment?.id ?? added.id) as string;
  agboardOk(mainProject, ['edit', '15', '--desc-file', writeBody(`## Work\n\nIntro text.\n\n![kept](attachment:${pictureId})\n`)]);

  const file = path.join(workspace(mainProject).folder, 'tasks', '15', 'TASK.md');

  await openBoard(page);
  await task(page, 15).click();
  await details(page).getByRole('button', { name: 'Make draft' }).click();
  await expect.poll(() => show(15).isDraft).toBe(true);
  expectHistoryNote(show(15).history.at(-1), ['Marked task as draft.']);
  expect(readFileSync(file, 'utf8')).toContain('reason: Marked task as draft.');
  const before = readFileSync(file, 'utf8');
  const beforeTime = statSync(file).mtimeMs;
  await details(page).getByRole('button', { name: 'Edit task' }).click();
  const dialog = page.getByRole('dialog', { name: /^#15 / });
  await expect(body(dialog).getByText('Intro text.')).toBeVisible();
  // Opened and closed with no change: the file is not written, and its time does not move.
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(readFileSync(file, 'utf8')).toBe(before);
  expect(statSync(file).mtimeMs).toBe(beforeTime);

  // Opened again, changed, and saved: the text is written once, and the picture's reference stays.
  await details(page).getByRole('button', { name: 'Edit task' }).click();
  const again = page.getByRole('dialog', { name: /^#15 / });
  await expect(body(again).getByText('Intro text.')).toBeVisible();
  await body(again).getByText('Intro text.').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Added line.');
  await expect(again.getByText('You have unsaved changes.')).toBeVisible();
  await again.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(again).toHaveCount(0);
  const stored = show(15);
  expect(stored.description).toContain('Intro text. Added line.');
  expect(stored.description).toContain(`attachment:${pictureId}`);
});

/** Writes a body to a file for `--desc-file` and returns its path. */
function writeBody(text: string): string {
  const file = path.join(work, `body-${Date.now()}-${Math.random().toString(16).slice(2)}.md`);
  writeFileSync(file, text);
  return file;
}
