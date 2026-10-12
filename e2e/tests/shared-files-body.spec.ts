import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { agboardOk, mainProject, projectId, resetBoard, cardBody, workspace, type CardJson, decisionJson } from '../helpers/agboard';
import { waitForSync } from '../helpers/ui';

// The task body on the real page: its sections and pictures, the answer to a decision request in three ways, a
// card that is Done and still takes an edit, and the edit dialog that saves once and rewrites nothing unless asked.

interface ShownCard extends CardJson {
  description: string;
  isDraft: boolean;
  history: { kind: string; reason: string | null; choiceId?: string | null; choiceLabel?: string | null }[];
}

const details = (page: Page) => page.getByRole('complementary', { name: 'Card details' });
const card = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });
const body = (dialog: Locator) => dialog.getByRole('textbox', { name: 'Description (Markdown)' });
const request = (page: Page, id: number) =>
  page.locator(`.card__answer[data-card-id="${id}"]`).getByRole('region', { name: 'The agent is waiting for your answer' });

function show(id: number): ShownCard {
  return JSON.parse(agboardOk(mainProject, ['show', String(id), '--json']).stdout).card;
}

async function openBoard(page: Page): Promise<void> {
  await page.goto(`/?project=${projectId(mainProject)}`);
  await waitForSync(page);
}

/** A decision request on card `id`, the card moved to Doing and running first, as an agent does. */
function askWithChoices(id: number, question: string, choices: { id: string; label: string }[]): void {
  if (show(id).cardStatus !== 'doing') agboardOk(mainProject, ['mv', String(id), 'doing', '--actor', 'human', '--reason', 'Doing it.']);
  agboardOk(mainProject, ['state', String(id), 'running', '--actor', 'ai', '--reason', 'Working.']);
  const file = path.join(work, `request-${id}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify({ question, choices }));
  agboardOk(mainProject, ['state', String(id), 'pending', '--actor', 'ai', '--request-json', readFileSync(file, 'utf8')]);
}

function askText(id: number, question: string): void {
  agboardOk(mainProject, ['state', String(id), 'running', '--actor', 'ai', '--reason', 'Working.']);
  agboardOk(mainProject, ['state', String(id), 'pending', '--actor', 'ai', '--request-json', decisionJson(question)]);
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
  await card(page, 13).click();
  const panel = details(page);
  // The body is written as numbered chapters; the captures sit in one group, side by side.
  await expect(panel.locator('.md-chapter__title', { hasText: /^Work$/ }).first()).toBeVisible();
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
  await card(page, 16).click();
  const answer = request(page, 16);
  await expect(answer.getByRole('radiogroup', { name: 'Choices' })).toBeVisible();
  const send = answer.getByRole('button', { name: 'Send', exact: true });
  await expect(send).toBeDisabled();
  await answer.getByRole('radio', { name: 'Proceed' }).check();
  await expect(send).toBeEnabled();
  await send.click();
  await expect(request(page, 16)).toHaveCount(0);
  expect(show(16)).toMatchObject({ agentStatus: 'idle' });
  expect(show(16).history.at(-1)).toMatchObject({ choiceId: 'proceed', choiceLabel: 'Proceed' });

  // Text alone, with no choice.
  askText(16, 'What name?');
  await expect(request(page, 16)).toContainText('What name?');
  await request(page, 16).getByRole('textbox', { name: 'Your answer' }).fill('Keep the old name.');
  await request(page, 16).getByRole('button', { name: 'Send', exact: true }).click();
  await expect(request(page, 16)).toHaveCount(0);
  expect(show(16).history.at(-1)).toMatchObject({ reason: 'Keep the old name.' });
  expect(show(16).history.at(-1)?.choiceId ?? null).toBeNull();

  // A choice and a note together.
  askWithChoices(16, 'Which way now?', choices);
  await expect(request(page, 16).getByRole('radio', { name: 'Stop' })).toBeVisible();
  await request(page, 16).getByRole('radio', { name: 'Stop' }).check();
  await request(page, 16).getByRole('textbox', { name: 'Your answer' }).fill('Stop after the backup.');
  await request(page, 16).getByRole('button', { name: 'Send', exact: true }).click();
  await expect(request(page, 16)).toHaveCount(0);
  expect(show(16).history.at(-1)).toMatchObject({ choiceId: 'stop', reason: 'Stop after the backup.' });
});

test('an answer with nothing chosen and nothing typed cannot be sent', async ({ page }) => {
  askWithChoices(15, 'Ready?', [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }]);
  await openBoard(page);
  await card(page, 15).click();
  const send = request(page, 15).getByRole('button', { name: 'Send', exact: true });
  await expect(send).toBeDisabled();
  await request(page, 15).getByRole('textbox', { name: 'Your answer' }).fill('   ');
  await expect(send).toBeDisabled();
  await request(page, 15).getByRole('radio', { name: 'Yes' }).check();
  await expect(send).toBeEnabled();
});

test('a card that is Done keeps its place until moved, and its body can still be edited and shown', async ({ page }) => {
  await openBoard(page);
  // The agent reports the work: the card stays in Doing, idle.
  agboardOk(mainProject, ['state', '13', 'running', '--actor', 'ai', '--reason', 'Working.']);
  agboardOk(mainProject, ['state', '13', 'idle', '--actor', 'ai', '--reason', 'Reported as finished.']);
  expect(show(13)).toMatchObject({ cardStatus: 'doing', agentStatus: 'idle' });
  await expect(page.getByRole('region', { name: 'Doing' }).getByRole('button', { name: /^#13(?!\d)/ })).toBeVisible();

  // The coordinator moves it to Done with a reason.
  agboardOk(mainProject, ['mv', '13', 'done', '--actor', 'human', '--reason', 'Accepted.']);
  await expect(page.getByRole('region', { name: 'Done' }).getByRole('button', { name: /^#13(?!\d)/ })).toBeVisible();

  // Done is not a lock: the body is edited and read back, and the state stays Done.
  agboardOk(mainProject, ['edit', '13', '--desc-file', writeBody(cardBody('Corrected after Done.'))]);
  expect(show(13)).toMatchObject({ cardStatus: 'done', agentStatus: 'idle' });
  await card(page, 13).click();
  await expect(details(page)).toContainText('Corrected after Done.');
  await expect(details(page)).toContainText('Done');

  // The page edits it too: a draft is made, the body saved, and the card is still Done.
  await details(page).getByRole('button', { name: 'Make draft' }).click();
  await details(page).getByRole('button', { name: 'Edit card' }).click();
  const dialog = page.getByRole('dialog', { name: /^#13 / });
  await expect(body(dialog).getByText('Corrected after Done.')).toBeVisible();
  await body(dialog).getByText('Corrected after Done.').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Second line after Done.');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(show(13)).toMatchObject({ cardStatus: 'done', isDraft: true });
  expect(show(13).description).toContain('Second line after Done.');
});

test('the edit dialog writes nothing when it is opened and closed unchanged, and saves its text and pictures once when changed', async ({ page }) => {
  const picture = path.join(work, 'keep.png');
  writeFileSync(picture, png);
  const added = JSON.parse(agboardOk(mainProject, ['attachment', 'add', '15', '--file', picture, '--actor', 'ai', '--json']).stdout);
  const pictureId = (added.attachment?.id ?? added.id) as string;
  agboardOk(mainProject, ['edit', '15', '--desc-file', writeBody(`## Work\n\nIntro text.\n\n![kept](attachment:${pictureId})\n`)]);

  const file = path.join(workspace(mainProject).folder, 'tasks', '15', 'TASK.md');
  const before = readFileSync(file, 'utf8');
  const beforeTime = statSync(file).mtimeMs;

  await openBoard(page);
  await card(page, 15).click();
  await details(page).getByRole('button', { name: 'Make draft' }).click();
  await details(page).getByRole('button', { name: 'Edit card' }).click();
  const dialog = page.getByRole('dialog', { name: /^#15 / });
  await expect(body(dialog).getByText('Intro text.')).toBeVisible();
  // Opened and closed with no change: the file is not written, and its time does not move.
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(readFileSync(file, 'utf8')).toBe(before);
  expect(statSync(file).mtimeMs).toBe(beforeTime);

  // Opened again, changed, and saved: the text is written once, and the picture's reference stays.
  await details(page).getByRole('button', { name: 'Edit card' }).click();
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
