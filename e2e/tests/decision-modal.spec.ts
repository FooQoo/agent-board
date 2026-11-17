import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '../helpers/fixtures';
import { agboardOk, askArgs, decisionJson, mainProject, questionJson, resetBoard, type TaskJson } from '../helpers/agboard';
import {
  answerButton,
  answerDialog,
  answerNote,
  answerSend,
  fillAnswer,
  laterButton,
  listRow,
  messageBand,
  messageList,
  openAnswer,
  openMessageList,
  pressSend,
  send,
  sendAnswer,
} from '../helpers/answer';
import { closeMessages } from '../helpers/answer-flow';
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

/** The agent asks on card #13 (Doing, idle on a fresh board) and does not wait; returns the question id. */
function ask(question: string): string {
  return JSON.parse(agboardOk(mainProject, ['--json', ...askArgs('13', decisionJson(question))]).stdout.split('\n')[0]).questions[0].id as string;
}

/** Like `ask`, for a question without options, which is answered with a note alone. */
function askNote(question: string): string {
  return JSON.parse(agboardOk(mainProject, ['--json', ...askArgs('13', questionJson(question, []))]).stdout.split('\n')[0]).questions[0].id as string;
}

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

let images: ImageServer;
let work: string;

test.beforeAll(async () => {
  images = await startImageServer();
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

  // A question with options needs one of them chosen before it can be sent.
  const dialog = await openAnswer(page, 13);
  await expect(answerSend(page)).toBeDisabled();
  await fillAnswer(dialog, { choice: 'Plan A' });
  await expect(answerSend(page)).toBeEnabled();
  await send(page);
  await closeMessages(page);
  await expect(answerButton(page, 13)).toHaveCount(0);
  expect(show(13)).toMatchObject({ agentStatus: 'idle', pendingRequestId: null });
  expectHistoryNote(show(13).history.at(-1), ['First question?', 'Plan A']);

  // A question without options is answered with a note alone, and is sent only once there is text.
  askNote('Second question?');
  await expect(answerButton(page, 13)).toBeVisible();
  const second = await openAnswer(page, 13);
  await expect(answerSend(page)).toBeDisabled();
  await fillAnswer(second, { text: 'Only a note.' });
  await send(page);
  await closeMessages(page);
  expectHistoryNote(show(13).history.at(-1), ['Second question?', 'Only a note.']);
  expect(show(13).history.at(-1)).not.toHaveProperty('choiceId');

  ask('Third question?');
  await expect(answerButton(page, 13)).toBeVisible();
  await sendAnswer(page, 13, { choice: 'Plan B', text: 'Both, then.' });
  await closeMessages(page);
  expectHistoryNote(show(13).history.at(-1), ['Third question?', 'Plan B', 'Both, then.']);
  await expect(lane(page, 'Doing').getByRole('button', { name: /^#13 AI Idle / })).toBeVisible();
});

// DM-2: Later closes the dialog without sending or keeping the input, and the board goes on updating.
test('Later closes the dialog without answering, and the board keeps updating', async ({ page }) => {
  ask('Keep me?');
  const dialog = await openAnswer(page, 13);
  await expect(dialog.getByRole('button', { name: 'Clear', exact: true })).toHaveCount(0);
  await answerNote(page).fill('Half an answer.');
  await expect(dialog.getByRole('button', { name: 'Clear', exact: true })).toBeVisible();
  await laterButton(page).click();
  await expect(dialog).toBeHidden();
  await expect(answerButton(page, 13)).toHaveText('Answer the question');

  // A change made through the CLI shows up, and nothing was sent.
  agboardOk(mainProject, ['add', 'Added while a question was open']);
  await expect(lane(page, 'Todo').getByText('Added while a question was open')).toBeVisible({ timeout: 15_000 });
  expect(show(13).agentStatus).toBe('pending');

  // The typed note is not kept: the question opens empty again, and Clear removes what is typed.
  await openAnswer(page, 13);
  await expect(answerNote(page)).toHaveValue('');
  await answerNote(page).fill('Another half.');
  await answerDialog(page).getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(answerNote(page)).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(answerDialog(page)).toBeHidden();
  expect(show(13).agentStatus).toBe('pending');
});

// DM-3: a question withdrawn while its dialog is open leaves the dialog, and cannot be answered any more.
test('a withdrawn question leaves the open dialog and cannot be answered', async ({ page }) => {
  const request = ask('Will this stay?');
  const dialog = await openAnswer(page, 13);
  await answerNote(page).fill('Typed before it was withdrawn.');

  // The agent withdraws the question while the dialog is open: the dialog shows the list, without the question.
  agboardOk(mainProject, ['message', 'withdraw', request, '--actor', 'ai']);
  await expect(dialog.getByRole('region', { name: 'Your answer' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Send answer' })).toHaveCount(0);
  await expect(dialog).not.toContainText('Will this stay?');
  expect(show(13)).toMatchObject({ agentStatus: 'idle', pendingRequestId: null });

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
  await page.route('**/api/projects/*/messages/answers', async (route) => {
    bodies.push(route.request().postData() ?? '');
    if (fail) {
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'database_error', reason: 'busy' } }) });
    }
    return route.fallback();
  });
  const dialog = await openAnswer(page, 13);
  await dialog.getByRole('radio', { name: 'Plan B' }).check();
  await answerNote(page).fill('Same answer, twice.');
  await pressSend(page);
  await expect(dialog.getByRole('alert')).toContainText('It could not be sent. Try again.');
  // The dialog still holds the answer.
  await expect(dialog).toContainText('Plan B');
  await expect(dialog).toContainText('Same answer, twice.');
  expect(show(13).agentStatus).toBe('pending');

  fail = false;
  // Sending again is the retry.
  await send(page);
  await expect(dialog.getByRole('region', { name: 'Your answer' })).toHaveCount(0);
  expect(bodies).toHaveLength(2);
  expect(JSON.parse(bodies[1])).toEqual(JSON.parse(bodies[0]));
  expectHistoryNote(show(13).history.at(-1), ['Will it fail?', 'Plan B', 'Same answer, twice.']);
});

// DM-6: the Messages band counts the open questions, the list shows each one, and each is answered on its own.
test('the band and the list show the open questions, and each is answered on its own', async ({ page }) => {
  const band = messageBand(page);
  // The fresh board already has one waiting card, #12.
  await expect(band.getByRole('listitem').first()).toContainText("AI's questions");
  await expect(band.getByRole('listitem').first()).toContainText('1 question, 0 approvals');
  ask('Which way for #13?');
  await expect(band.getByRole('listitem').first()).toContainText('2 questions, 0 approvals');

  const list = await openMessageList(page);
  await expect(list.getByRole('tab', { name: /^AI's questions 2$/ })).toBeVisible();
  const rows = list.getByRole('button', { name: /^Question AI/ });
  await expect(rows).toHaveCount(2);
  await expect(listRow(page, /Which way for #13\?/)).toContainText('Unanswered');

  // Opening a row shows that question in the same dialog; the first is answered and the list comes back.
  await listRow(page, /Which way for #13\?/).click();
  await expect(answerDialog(page)).toContainText('#13 stay blocked until you reply');
  await fillAnswer(answerDialog(page), { choice: 'Plan A', text: 'Replace it.' });
  await send(page);
  await expect(messageList(page).getByRole('tab', { name: /^AI's questions 1$/ })).toBeVisible();
  // The answered question stays listed, not counted, until an agent takes the answer in.
  await expect(rows).toHaveCount(2);
  await expect(listRow(page, /Which way for #13\?/)).toContainText('Answered, waiting for an AI');
  expect(show(13)).toMatchObject({ agentStatus: 'idle', pendingRequestId: null });
  expect(show(12).agentStatus).toBe('pending');
  expectHistoryNote(show(13).history.at(-1), ['Which way for #13?', 'Plan A', 'Replace it.']);

  // Answering the other one leaves nothing waiting for the person.
  await rows.filter({ hasText: 'Unanswered' }).click();
  await fillAnswer(answerDialog(page), { choice: 'Allow breaking changes' });
  await send(page);
  await expect(messageList(page).getByRole('tab', { name: /^AI's questions 0$/ })).toBeVisible();
  await expect(rows.filter({ hasText: 'Unanswered' })).toHaveCount(0);
  await closeMessages(page);
  await expect(band.getByRole('listitem').first()).toContainText(/AI's questions\s*0/);
  expect(show(12)).toMatchObject({ agentStatus: 'idle', pendingRequestId: null });
});
