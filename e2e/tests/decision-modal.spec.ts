import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { agboardOk, decisionJson, mainProject, resetBoard, type TaskJson } from '../helpers/agboard';
import { answerButton, answerDialog, answerNote, answerSend, openAnswer, sendAnswer } from '../helpers/answer';
import { expectHistoryNote } from '../helpers/history';
import { startImageServer, type ImageServer } from '../helpers/imageServer';
import { readBoardAfterReset, waitForSync } from '../helpers/ui';

// The answer dialog of a card that waits for a decision, on the real page and the real CLI: the card shows
// only a button, and the question, the options and the note are in the dialog.

interface Shown extends TaskJson {
  history: { at: string; reason: string }[];
}

const lane = (page: Page, name: string) => page.getByRole('region', { name });

function show(id: number): Shown {
  return JSON.parse(agboardOk(mainProject, ['show', String(id), '--json']).stdout).task;
}

/** The agent asks on card #13 (Doing, idle on a fresh board) and does not wait. */
function ask(question: string): void {
  agboardOk(mainProject, ['state', '13', 'pending', '--actor', 'ai', '--no-wait', '--request-json', decisionJson(question)]);
}

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

let images: ImageServer;
let work: string;

test.beforeAll(async () => {
  images = await startImageServer(9641);
  work = mkdtempSync(path.join(os.tmpdir(), 'agent-board-e2e-dm-'));
});

test.afterAll(async () => {
  await images.close();
  rmSync(work, { recursive: true, force: true });
});

test.beforeEach(async ({ page }) => {
  resetBoard(mainProject);
  await page.goto('/');
  await waitForSync(page);
  await readBoardAfterReset(page);
});

// DM-1: the card button opens the dialog; a choice, a note, or both answer; the card goes Idle and the history keeps it.
test('the card button answers with a choice only, a note only, or both, and the history keeps the answer', async ({ page }) => {
  ask('First question?');
  await expect(answerButton(page, 13)).toHaveText('Answer the question');
  // The card shows no question text, options or note field.
  await expect(lane(page, 'Doing').getByText('First question?')).toHaveCount(0);
  await expect(lane(page, 'Doing').getByRole('textbox')).toHaveCount(0);
  await expect(lane(page, 'Doing').getByRole('radio')).toHaveCount(0);

  await sendAnswer(page, 13, { choice: 'Plan A' });
  await expect(answerButton(page, 13)).toHaveCount(0);
  expect(show(13)).toMatchObject({ agentStatus: 'idle', pendingRequestId: null });
  expectHistoryNote(show(13).history.at(-1), ['First question?', 'Plan A']);

  ask('Second question?');
  await expect(answerButton(page, 13)).toBeVisible();
  await sendAnswer(page, 13, { text: 'Only a note.' });
  expectHistoryNote(show(13).history.at(-1), ['Second question?', 'Only a note.']);
  expect(show(13).history.at(-1)).not.toHaveProperty('choiceId');

  ask('Third question?');
  await expect(answerButton(page, 13)).toBeVisible();
  await sendAnswer(page, 13, { choice: 'Plan B', text: 'Both, then.' });
  expectHistoryNote(show(13).history.at(-1), ['Third question?', 'Plan B', 'Both, then.']);
  await expect(lane(page, 'Doing').getByRole('button', { name: /^#13 AI Idle / })).toBeVisible();
});

// DM-2: closing keeps the input, the board goes on updating, and Clear shows only while there is input.
test('a closed dialog keeps its input while the board keeps updating', async ({ page }) => {
  ask('Keep me?');
  const dialog = await openAnswer(page, 13);
  await expect(dialog.getByRole('button', { name: 'Clear', exact: true })).toHaveCount(0);
  await answerNote(page).fill('Half an answer.');
  await expect(dialog.getByRole('button', { name: 'Clear', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(answerButton(page, 13)).toHaveText('Continue answering');
  await expect(answerButton(page, 13)).toBeFocused();

  // A change made through the CLI shows up although an answer is kept.
  agboardOk(mainProject, ['add', 'Added while an answer was kept']);
  await expect(lane(page, 'Todo').getByText('Added while an answer was kept')).toBeVisible({ timeout: 15_000 });

  await openAnswer(page, 13);
  await expect(answerNote(page)).toHaveValue('Half an answer.');
  await answerDialog(page).getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(answerNote(page)).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(answerButton(page, 13)).toHaveText('Answer the question');
  expect(show(13).agentStatus).toBe('pending');
});

// DM-3: a withdrawn question stays readable, and only closing is left.
test('a withdrawn question stays readable in the open dialog and cannot be sent', async ({ page }) => {
  ask('Will this stay?');
  const dialog = await openAnswer(page, 13);
  await answerNote(page).fill('Typed before it was withdrawn.');

  // A person's move cancels the request.
  agboardOk(mainProject, ['mv', '13', 'todo', '--actor', 'human', '--reason', 'Back to Todo.']);
  await expect(dialog).toContainText('This question was withdrawn. You can no longer answer it.');
  await expect(dialog).toContainText('Will this stay?');
  await expect(answerNote(page)).toHaveValue('Typed before it was withdrawn.');
  await expect(answerNote(page)).toBeDisabled();
  await expect(answerSend(page)).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(answerButton(page, 13)).toHaveCount(0);
});

// DM-4: the question is Markdown, with an attached picture and an external one.
test('the question shows a table, code, a link, an attached picture and an external picture', async ({ page }) => {
  const picture = path.join(work, 'attached.png');
  writeFileSync(picture, png);
  const added = JSON.parse(agboardOk(mainProject, ['attachment', 'add', '13', '--file', picture, '--actor', 'ai', '--json']).stdout);
  const id = (added.attachment?.id ?? added.id) as string;
  const question = [
    '## Plan',
    '',
    '| Option | Cost |',
    '| --- | --- |',
    '| Replace | low |',
    '',
    'Run `agboard setup` and read [the notes](' + images.origin + '/page.html).',
    '',
    '```ts',
    'const answer = 42;',
    '```',
    '',
    `![attached picture](attachment:${id})`,
    '',
    `![remote picture](${images.origin}/ok.png)`,
  ].join('\n');
  ask(question);
  const dialog = await openAnswer(page, 13);
  await expect(dialog.getByRole('heading', { name: 'Plan' })).toBeVisible();
  await expect(dialog.getByRole('table')).toContainText('low');
  await expect(dialog.locator('pre code')).toContainText('const answer = 42;');
  await expect(dialog.getByRole('link', { name: 'the notes' })).toHaveAttribute('href', `${images.origin}/page.html`);

  const attached = dialog.getByRole('img', { name: 'attached picture' });
  await expect(attached).toBeVisible();
  await expect(attached).toHaveAttribute('src', new RegExp(`/tasks/13/attachments/${id}$`));
  await expect.poll(() => attached.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  const remote = dialog.getByRole('img', { name: 'remote picture' });
  await expect(remote).toBeVisible();
  await expect.poll(() => remote.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  // The answer side is not pushed out by the question.
  await expect(answerNote(page)).toBeVisible();
  await expect(answerDialog(page).getByRole('button', { name: 'Close', exact: true }).last()).toBeVisible();
});

// DM-5: a failed send keeps the input; the retry sends the same answer.
test('a failed send keeps the input and the retry sends the same answer', async ({ page }) => {
  ask('Will it fail?');
  const bodies: string[] = [];
  let fail = true;
  await page.route('**/api/projects/*/tasks/13/answer', async (route) => {
    bodies.push(route.request().postData() ?? '');
    if (fail) {
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'database_error', reason: 'busy' } }) });
    }
    return route.fallback();
  });
  const dialog = await openAnswer(page, 13);
  await dialog.getByRole('radio', { name: 'Plan B' }).check();
  await answerNote(page).fill('Same answer, twice.');
  await answerSend(page).click();
  await expect(dialog.getByRole('alert')).toContainText('Could not save. Try again.');
  await expect(answerNote(page)).toHaveValue('Same answer, twice.');
  await expect(dialog.getByRole('radio', { name: 'Plan B' })).toBeChecked();
  expect(show(13).agentStatus).toBe('pending');

  fail = false;
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(bodies).toHaveLength(2);
  expect(JSON.parse(bodies[1])).toEqual(JSON.parse(bodies[0]));
  expectHistoryNote(show(13).history.at(-1), ['Will it fail?', 'Plan B', 'Same answer, twice.']);
});
