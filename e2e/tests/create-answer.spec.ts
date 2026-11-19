import { expectHistoryNote } from '../helpers/history';
import { expect, test, type Page } from '../helpers/fixtures';
import { agboardOk, mainProject, resetBoard, type TaskJson, askArgs, decisionJson } from '../helpers/agboard';
import { readBoardAfterReset, waitForSync } from '../helpers/ui';
import { answerButton, answerDialog, answerNote, answerSend, fillAnswer, laterButton, openAnswer, pressSend, send } from '../helpers/answer';
import { closeMessages } from '../helpers/answer-flow';

// Answering a decision request on its card, on the real page.

interface ShownTask extends TaskJson {
  description: string;
  body: string;
  draft: 'human' | 'ai' | null;
  history: { at: string; reason: string }[];
}

const details = (page: Page) => page.getByRole('complementary', { name: 'Task details' });
const lane = (page: Page, name: string) => page.getByRole('region', { name });
const task = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });

function show(id: number): ShownTask {
  return JSON.parse(agboardOk(mainProject, ['show', String(id), '--json']).stdout).task;
}

test.beforeEach(async ({ page }) => {
  resetBoard(mainProject);
  await page.goto('/');
  await waitForSync(page);
  await readBoardAfterReset(page);
});

// ------------------------------------------------------------------ Answering in the dialog

const compat = 'Keep compatibility (recommended)';

test('a waiting card opens its answer in a dialog; Later closes it without sending', async ({ page }) => {
  await task(page, 12).click();
  const panel = details(page);
  // The card shows only the button; the question and the form are in the dialog, and the details do not repeat them.
  await expect(panel.getByRole('region', { name: 'The agent is waiting for your answer' })).toHaveCount(0);
  await expect(answerButton(page)).toHaveText('Answer the question');
  await expect(page.getByRole('textbox', { name: 'Note' })).toHaveCount(0);
  await panel.getByRole('tab', { name: /^History/ }).click();

  const dialog = await openAnswer(page);
  const note = answerNote(page);
  await expect(dialog).toContainText('Waiting for confirmation on how to replace a board.');
  // Nothing to send yet; a note alone is enough, even for a question with options.
  await expect(answerSend(page)).toBeDisabled();
  await note.fill('Keep the current name.\nDo not migrate.');
  await expect(answerSend(page)).toBeEnabled();

  // Later closes the dialog without sending, and keeps nothing: the card still asks the question.
  await laterButton(page).click();
  await expect(dialog).toBeHidden();
  await expect(answerButton(page)).toHaveText('Answer the question');
  expect(show(12).agentStatus).toBe('pending');
  // The detail history remains readable.
  await expect(panel.getByRole('tabpanel').getByRole('listitem').first()).toContainText('Waiting for confirmation');

  // Selecting another card opens its details; the question of #12 is still there to answer.
  await task(page, 13).click();
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Check the board display');
  await task(page, 12).click();
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Restore a board from JSON');
  await openAnswer(page);
  await expect(note).toHaveValue('');

  // Clear removes the input and is offered only while there is input; the request is still waiting.
  await note.fill('Typed again.');
  await dialog.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(note).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'Clear', exact: true })).toHaveCount(0);
  expect(show(12).agentStatus).toBe('pending');
  await fillAnswer(dialog, { choice: compat, text: 'Keep the current name.\nDo not migrate.' });
  await send(page);
  await closeMessages(page);

  // The card is Idle without a button, and the answer is in the detail history.
  await expect(answerButton(page)).toHaveCount(0);
  await expect(lane(page, 'Doing').getByRole('button', { name: /^#12 AI Idle Restore a board from JSON / })).toBeVisible();
  await panel.getByRole('tab', { name: /^History/ }).click();
  const newest = panel.getByRole('tabpanel').getByRole('listitem').first();
  await expect(newest).toContainText('Do not migrate.');
  await expect(newest.getByRole('img')).toHaveCount(0);
  const stored = show(12);
  expect(stored).toMatchObject({ agentStatus: 'idle', pendingReason: null, pendingRequestId: null });
  expectHistoryNote(stored.history.at(-1), ['Waiting for confirmation on how to replace a board.', compat, 'Keep the current name.\nDo not migrate.']);
});

test('while it is sent the dialog cannot be sent twice; a failure keeps the answer and can be retried', async ({
  page,
}) => {
  let mode: 'fail' | 'hold' | 'pass' = 'fail';
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let posts = 0;
  await page.route('**/api/projects/*/messages/answers', async (route) => {
    posts += 1;
    if (mode === 'fail') {
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'database_error', reason: 'busy' } }) });
    }
    if (mode === 'hold') await gate;
    return route.fallback();
  });
  const dialog = await openAnswer(page);
  await fillAnswer(dialog, { choice: compat, text: 'My answer.' });
  await pressSend(page);

  // Failed: the answer and the dialog stay, the error is announced, and nothing changed.
  await expect(dialog.getByRole('alert')).toContainText('It could not be sent. Try again.');
  await expect(dialog).toContainText('My answer.');
  expect(show(12).agentStatus).toBe('pending');

  // Sent again while the server is slow: the answer is sent once, and the form is locked meanwhile.
  mode = 'hold';
  await pressSend(page);
  await expect(dialog.getByRole('button', { name: 'Sending…' })).toBeDisabled();
  await expect(answerNote(page)).toBeDisabled();
  expect(posts).toBe(2);
  release();
  await expect(dialog.getByRole('region', { name: 'Your answer' })).toHaveCount(0);
  expect(posts).toBe(2);
  expect(show(12)).toMatchObject({ agentStatus: 'idle' });
  expectHistoryNote(show(12).history.at(-1), ['Waiting for confirmation on how to replace a board.', 'My answer.']);
});

/** A person's move drops the old question; the agent then runs again and asks something else. */
function askAgain(reason: string): void {
  // The agent withdraws the open question before it asks a new one.
  const open = show(12).pendingRequestId;
  if (open) {
    agboardOk(mainProject, ['message', 'withdraw', open, '--actor', 'ai']);
  }
  agboardOk(mainProject, ['mv', '12', 'todo', '--actor', 'human', '--reason', 'Back to Todo.']);
  agboardOk(mainProject, ['mv', '12', 'doing', '--actor', 'human', '--reason', 'Doing again.']);
  agboardOk(mainProject, ['state', '12', 'running', '--actor', 'ai', '--reason', 'Moving on.']);
  agboardOk(mainProject, askArgs('12', decisionJson(reason)));
}

test('when the agent asks something else while the dialog is open, the old question leaves it and the new one is answered on its own', async ({
  page,
}) => {
  const dialog = await openAnswer(page);
  await fillAnswer(dialog, { choice: compat, text: 'An answer to the old question.' });
  const oldRequest = show(12).pendingRequestId;

  askAgain('A different question now.');
  expect(show(12).pendingRequestId).not.toBe(oldRequest);

  // The old question is gone from the dialog, which shows the list with the new question.
  await expect(dialog.getByRole('region', { name: 'Your answer' })).toHaveCount(0);
  await expect(answerSend(page)).toHaveCount(0);
  await dialog.getByRole('button', { name: /^Question AI .*A different question now\./ }).click();
  await expect(dialog).toContainText('A different question now.');
  await expect(answerNote(page)).toHaveValue('');
  await fillAnswer(dialog, { choice: 'Plan A', text: 'An answer to the new question.' });
  await send(page);
  expectHistoryNote(show(12).history.at(-1), ['A different question now.', 'An answer to the new question.']);
  expect(show(12).history.filter((event) => event.reason.includes('An answer to the old question.'))).toHaveLength(0);
});

test('an answer sent from a page that missed the new request is refused by the server and not saved', async ({ page }) => {
  const dialog = await openAnswer(page);
  await fillAnswer(dialog, { choice: compat, text: 'An answer to the old question.' });

  // This page cannot refresh its board, so it still shows the old request when the agent asks again.
  await page.route('**/api/projects/*/summary', (route) => route.abort());
  askAgain('A different question now.');
  await expect(dialog).toContainText('Waiting for confirmation on how to replace a board.');
  const answered = page.waitForResponse((response) => response.url().endsWith('/messages/answers'));
  await pressSend(page);
  expect((await answered).status()).toBe(409);
  await expect(dialog.getByRole('alert')).toBeVisible();
  // Nothing was saved: still waiting, now with the new question.
  expect(show(12)).toMatchObject({ agentStatus: 'pending', pendingReason: 'A different question now.' });
  expect(show(12).history.filter((event) => event.reason.includes('An answer to the old question.'))).toHaveLength(0);

  // Once the board can be read, the dialog no longer offers the old question.
  await page.unroute('**/api/projects/*/summary');
  agboardOk(mainProject, ['add', 'Triggers a refresh']);
  await expect(dialog.getByRole('button', { name: /^Question AI .*A different question now\./ })).toBeVisible();
  await expect(answerSend(page)).toHaveCount(0);
});

test('a long question does not grow the card; the dialog reads all of it', async ({ page }) => {
  const lines = Array.from({ length: 14 }, (_, index) => `Line ${index + 1} of a long question about the release plan.`);
  agboardOk(mainProject, askArgs('13', decisionJson(lines.join('\n'))));
  await expect(answerButton(page, 13)).toBeVisible();
  // The card shows no question text, so its height does not follow the question.
  await expect(page.locator('.card__item').getByText('Line 1 of a long question')).toHaveCount(0);
  const card = answerButton(page, 13).locator('xpath=ancestor::div[contains(@class,"card__item")]');
  expect((await card.boundingBox())!.height).toBeLessThan(200);

  const dialog = await openAnswer(page, 13);
  await expect(dialog).toContainText('Line 1 of a long question about the release plan.');
  await expect(dialog).toContainText('Line 14 of a long question about the release plan.');
  await expect(answerNote(page)).toBeVisible();
  await expect(answerDialog(page).getByRole('button', { name: 'Send answer' })).toBeVisible();
});
