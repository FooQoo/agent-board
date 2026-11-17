import { expectHistoryNote } from '../helpers/history';
import { expect, test, type Page } from '../helpers/fixtures';
import { agboardOk, listTasks, mainProject, nextTaskId, resetBoard, taskBody, type TaskJson, askArgs, decisionJson } from '../helpers/agboard';
import { startImageServer, type ImageServer } from '../helpers/imageServer';
import { openManualCreateDialog, pasteMarkdown, closeForUpdates, readBoardAfterReset, waitForSync } from '../helpers/ui';
import { putDraft } from '../helpers/drafts';
import { answerButton, answerNote, answerSend, openAnswer, reachSend, pressSend, send } from '../helpers/answer';

// Adding a card in the shared dialog, and answering a decision request on its card, on the real page.

interface ShownTask extends TaskJson {
  description: string;
  body: string;
  isDraft: boolean;
  history: { at: string; reason: string }[];
}

const details = (page: Page) => page.getByRole('complementary', { name: 'Task details' });
const lane = (page: Page, name: string) => page.getByRole('region', { name });
const task = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });

function show(id: number): ShownTask {
  return JSON.parse(agboardOk(mainProject, ['show', String(id), '--json']).stdout).task;
}

let images: ImageServer;

test.beforeAll(async () => {
  images = await startImageServer();
});
test.afterAll(async () => {
  await images.close();
});

test.beforeEach(async ({ page }) => {
  resetBoard(mainProject);
  await page.goto('/');
  await waitForSync(page);
  await readBoardAfterReset(page);
});

// ------------------------------------------------------------------ Adding a card

test('a task is added with a title, the AI as the default owner, and a Markdown body; it is not a draft', async ({
  page,
}) => {
  const id = nextTaskId(mainProject);
  const dialog = await openManualCreateDialog(page);
  await expect(dialog).toContainText('Add task');
  // The owner defaults to the AI; nothing can be added without a title.
  await expect(dialog.getByRole('radio', { name: 'AI', exact: true })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: 'User', exact: true })).not.toBeChecked();
  const add = dialog.getByRole('button', { name: 'Add', exact: true });
  await expect(add).toBeDisabled();
  // The body starts empty and the outline has a hint until there is a heading.
  const editor = dialog.getByRole('textbox', { name: 'Description (Markdown)' });
  await expect(dialog.getByText('0 / 50,000')).toBeVisible();
  await expect(dialog.getByText('Add a heading (## ) and the outline appears here.')).toBeVisible();

  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill('Plan the release');
  await expect(add).toBeEnabled();
  // The body is plain Markdown with no headings, so the outline is empty; the pictures are typed as Markdown.
  await pasteMarkdown(
    editor,
    taskBody(`Ship it.\n\n![found](${images.origin}/ok.png)\n\n![lost](${images.origin}/missing.png)`),
  );
  await expect(dialog.getByRole('navigation', { name: 'Outline' }).getByRole('button')).toHaveCount(0);
  await expect(dialog.getByText(/^\d+ \/ 50,000$/)).not.toHaveText('0 / 50,000');
  await expect(add).toBeEnabled();

  await add.click();
  await expect(dialog).toHaveCount(0);

  // The CLI sees an ordinary new card: Todo, Idle, the AI's, not a draft, with the text as typed.
  const stored = show(id);
  expect(stored).toMatchObject({ title: 'Plan the release', taskStatus: 'todo', agentStatus: 'idle', assignee: 'ai', isDraft: false });
  expect(stored.description).toContain('Ship it.');
  // A pasted picture keeps its alt text and URL; the editor may add a title equal to the alt text.
  expect(stored.description).toContain(`![found](${images.origin}/ok.png`);
  expect(stored.description).toContain(`![lost](${images.origin}/missing.png`);
  await expect(lane(page, 'Todo').getByRole('button', { name: new RegExp(`^#${id} AI Plan the release `) })).toBeVisible();

  // The owner cannot be changed afterwards: the details have no control for it, and neither has the editor.
  await task(page, id).click();
  await expect(details(page).getByRole('radiogroup')).toHaveCount(0);
  await expect(details(page).getByRole('combobox')).toHaveCount(0);
  await putDraft(id);
  await details(page).getByRole('button', { name: 'Open full screen (task)', exact: true }).click();
  const editing = page.getByRole('dialog', { name: new RegExp(`^#${id} Task preview`) });
  await expect(editing).toBeVisible();
  await expect(editing.getByRole('radiogroup')).toHaveCount(0);
  await expect(editing.getByText('Assignee')).toHaveCount(0);
});

test('a task for the user is added without a body; closing without typing asks nothing', async ({ page }) => {
  const id = nextTaskId(mainProject);
  const dialog = await openManualCreateDialog(page);
  await dialog.getByRole('radio', { name: 'User', exact: true }).check();
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill('Check the invoice');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  // No body given: the CLI writes the frontmatter with no conditions and an empty body.
  expect(show(id)).toMatchObject({ title: 'Check the invoice', assignee: 'human', isDraft: false, agentStatus: 'idle' });
  expect(show(id).body).toBe('');
  expect(show(id).description).toContain('acceptance: []\nhistory:\n- at:');
  expect(show(id).history).toHaveLength(1);
  expectHistoryNote(show(id).history[0], ['Created task in Todo', 'agent idle']);
  await task(page, id).click();

  await openManualCreateDialog(page);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect(listTasks(mainProject).map((item) => item.id)).toEqual(expect.not.arrayContaining([id + 1]));
});

test('a title or body over the limit cannot be added', async ({ page }) => {
  const dialog = await openManualCreateDialog(page);
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill('Long body');
  await dialog.getByRole('textbox', { name: 'Description (Markdown)' }).click();
  // The counter counts the Markdown the editor writes, so the text is filled up to the limit by reading it.
  const counter = dialog.locator('.editor__counter');
  const shown = async () => Number((await counter.textContent())!.split('/')[0].replace(/,/g, '').trim());
  await page.keyboard.insertText('x'.repeat(50_000));
  await expect.poll(shown).toBeGreaterThan(49_000);
  await page.waitForTimeout(300);
  await page.keyboard.insertText('x'.repeat(50_001 - (await shown())));
  await expect(dialog.locator('.editor__counter', { hasText: '50,001 / 50,000' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
  await expect(dialog.getByText('Over the 50,000-character limit. Remove 1 character.')).toBeVisible();
  await page.keyboard.press('Backspace');
  await expect(dialog.getByRole('button', { name: 'Add', exact: true })).toBeEnabled();
});

// ------------------------------------------------------------------ Answering in the dialog

test('a waiting card opens its answer in a dialog; the input stays on the card when the dialog is closed', async ({ page }) => {
  await task(page, 12).click();
  const panel = details(page);
  // The card shows only the button; the question and the form are in the dialog, and the details do not repeat them.
  await expect(panel.getByRole('region', { name: 'The agent is waiting for your answer' })).toHaveCount(0);
  await expect(answerButton(page)).toHaveText('Answer the question');
  await expect(page.getByRole('textbox', { name: 'Note' })).toHaveCount(0);
  await panel.getByRole('tab', { name: /^History/ }).click();

  const dialog = await openAnswer(page);
  const note = answerNote(page);
  const held = (count: number) => dialog.getByText(`${count} answered`, { exact: true });
  await expect(dialog).toContainText('Waiting for confirmation on how to replace a board.');
  // Only an answer with content is held for the send.
  await expect(held(0)).toBeVisible();
  await note.fill('   ');
  await expect(held(0)).toBeVisible();
  await note.fill('Keep the current name.\nDo not migrate.');
  await expect(held(1)).toBeVisible();

  // Closing needs no confirmation: the input stays and the card offers to continue.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(answerButton(page)).toHaveText('Continue answering');
  await expect(answerButton(page)).toBeFocused();
  // The detail history remains readable while the answer is kept.
  await expect(panel.getByRole('tabpanel').getByRole('listitem').first()).toContainText('Waiting for confirmation');

  // Dragging the card within its lane is allowed while an answer is kept.
  const source = await answerButton(page).locator('xpath=ancestor::div[contains(@class,"card__item")]').locator('.grip').boundingBox();
  const target = await task(page, 13).boundingBox();
  if (!source || !target) throw new Error('Could not measure the pending task drag.');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 20, source.y + source.height / 2 + 8, { steps: 4 });
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(answerButton(page)).toHaveText('Continue answering');

  // Selecting another card opens its details without clearing the kept input.
  await task(page, 13).click();
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Check the board display');
  await task(page, 12).click();
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Restore a board from JSON');
  await openAnswer(page);
  await expect(note).toHaveValue('Keep the current name.\nDo not migrate.');

  // Clear removes the input and is offered only while there is input; the request is still waiting.
  await dialog.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(note).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'Clear', exact: true })).toHaveCount(0);
  expect(show(12).agentStatus).toBe('pending');
  await note.fill('Keep the current name.\nDo not migrate.');
  // The review shows the answer before it is sent.
  await reachSend(page);
  await expect(dialog).toContainText('Do not migrate.');
  await send(page);

  // The dialog closes, the card is Idle without a button, and the answer is in the detail history.
  await expect(dialog).toBeHidden();
  await expect(answerButton(page)).toHaveCount(0);
  await expect(lane(page, 'Doing').getByRole('button', { name: /^#12 AI Idle Restore a board from JSON / })).toBeVisible();
  await panel.getByRole('tab', { name: /^History/ }).click();
  const newest = panel.getByRole('tabpanel').getByRole('listitem').first();
  await expect(newest).toContainText('Do not migrate.');
  await expect(newest.getByRole('img')).toHaveCount(0);
  const stored = show(12);
  expect(stored).toMatchObject({ agentStatus: 'idle', pendingReason: null, pendingRequestId: null });
  expectHistoryNote(stored.history.at(-1), ['Waiting for confirmation on how to replace a board.', 'Keep the current name.\nDo not migrate.']);
});

test('while it is sent the dialog cannot be sent twice or closed; a failure keeps the answer and can be retried', async ({
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
  await answerNote(page).fill('My answer.');
  await pressSend(page);

  // Failed: the answer and the dialog stay, the error is announced, and nothing changed.
  await expect(dialog.getByRole('alert')).toContainText('Could not save. Try again.');
  await expect(dialog).toContainText('My answer.');
  expect(show(12).agentStatus).toBe('pending');

  // Retried while the server is slow: the dialog is locked and sends once.
  mode = 'hold';
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Sending…' })).toBeDisabled();
  await expect(answerNote(page)).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  expect(posts).toBe(2);
  release();
  await expect(dialog).toBeHidden();
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

test('when the agent asks something else while the dialog is open, the old question is marked withdrawn and the new one is added to the run', async ({
  page,
}) => {
  const dialog = await openAnswer(page);
  const box = answerNote(page);
  await dialog.getByRole('radio').first().check();
  await box.fill('An answer to the old question.');
  const oldRequest = show(12).pendingRequestId;

  askAgain('A different question now.');
  expect(show(12).pendingRequestId).not.toBe(oldRequest);

  // The open dialog holds no updates back: the question shown can be read but no longer answered.
  await expect(dialog).toContainText('This question was withdrawn. You can no longer answer it.');
  await expect(box).toBeDisabled();
  await expect(box).toHaveValue('An answer to the old question.');
  // A card's run has no review step: the progress lists its two questions only.
  const progress = dialog.getByRole('navigation', { name: 'Answering progress' });
  await expect(progress.getByRole('button')).toHaveCount(2);

  // The new question comes next in the run; its answer is sent, the old one is left out.
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(dialog).toContainText('A different question now.');
  await expect(dialog.getByText('2 / 2')).toBeVisible();
  await answerNote(page).fill('An answer to the new question.');
  // A card's run has no review: its last question sends, and only the new answer counts.
  await reachSend(page);
  await expect(dialog.getByText('1 answered', { exact: true })).toBeVisible();
  await send(page);
  expectHistoryNote(show(12).history.at(-1), ['A different question now.', 'An answer to the new question.']);
  expect(show(12).history.filter((event) => event.reason.includes('An answer to the old question.'))).toHaveLength(0);
});

test('an answer sent from a page that missed the new request is refused by the server and not saved', async ({ page }) => {
  const dialog = await openAnswer(page);
  await answerNote(page).fill('An answer to the old question.');

  // This page cannot refresh its board, so it still shows the old request when the agent asks again.
  await page.route('**/api/projects/*/summary', (route) => route.abort());
  askAgain('A different question now.');
  await expect(dialog).toContainText('Waiting for confirmation on how to replace a board.');
  const answered = page.waitForResponse((response) => response.url().endsWith('/messages/answers'));
  await pressSend(page);
  expect((await answered).status()).toBe(409);
  await expect(dialog.getByRole('alert')).toContainText('Some questions were answered or withdrawn elsewhere.');
  // The answer stays in the dialog on a question that is now withdrawn, so nothing can be sent.
  await expect(dialog).toContainText('An answer to the old question.');
  await expect(dialog).toContainText('This question was withdrawn. You can no longer answer it.');
  await expect(answerSend(page)).toBeDisabled();
  // Nothing was saved: still waiting, now with the new question.
  expect(show(12)).toMatchObject({ agentStatus: 'pending', pendingReason: 'A different question now.' });
  expect(show(12).history.filter((event) => event.reason.includes('An answer to the old question.'))).toHaveLength(0);

  // Once the board can be read, the new question joins the run.
  await page.unroute('**/api/projects/*/summary');
  agboardOk(mainProject, ['add', 'Triggers a refresh']);
  await expect(dialog.getByRole('navigation', { name: 'Answering progress' }).getByRole('button')).toHaveCount(2);
  await expect(dialog).toContainText('An answer to the old question.');
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
  // The card's only question is the last one, so the dialog offers Send, not Next.
  await expect(dialog.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
});
