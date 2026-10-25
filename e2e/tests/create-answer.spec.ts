import { expectHistoryNote } from '../helpers/history';
import { expect, test, type Page } from '@playwright/test';
import { agboardOk, listTasks, mainProject, nextTaskId, resetBoard, taskBody, type TaskJson, decisionJson } from '../helpers/agboard';
import { startImageServer, type ImageServer } from '../helpers/imageServer';
import { openManualCreateDialog, pasteMarkdown, closeForUpdates, readBoardAfterReset, waitForSync } from '../helpers/ui';

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
const request = (page: Page, id = 12) =>
  page.locator(`.card__answer[data-task-id="${id}"]`);

function show(id: number): ShownTask {
  return JSON.parse(agboardOk(mainProject, ['show', String(id), '--json']).stdout).task;
}

let images: ImageServer;

test.beforeAll(async () => {
  images = await startImageServer(7891);
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
  await details(page).getByRole('button', { name: 'Make draft' }).click();
  await details(page).getByRole('button', { name: 'Edit task' }).click();
  const editing = page.getByRole('dialog', { name: new RegExp(`^#${id} Edit task`) });
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

// ------------------------------------------------------------------ Answering in place

test('a waiting task answers in place while details stay independently available', async ({ page }) => {
  await task(page, 12).click();
  const panel = details(page);
  // The answer is shown and typed on the card only; the details do not repeat the request.
  await expect(panel.getByRole('region', { name: 'The agent is waiting for your answer' })).toHaveCount(0);
  await expect(request(page).getByRole('textbox', { name: 'Your answer' })).toBeVisible();
  await panel.getByRole('tab', { name: /^History/ }).click();

  // The detail history remains readable while the answer stays on the card.
  const answerBox = request(page).getByRole('textbox', { name: 'Your answer' });
  const send = request(page).getByRole('button', { name: 'Send', exact: true });
  await expect(send).toBeDisabled();
  await answerBox.fill('   ');
  await expect(send).toBeDisabled();
  await answerBox.fill('Keep the current name.\nDo not migrate.');
  await expect(panel.getByRole('tabpanel').getByRole('listitem').first()).toContainText('Waiting for confirmation');
  await expect(answerBox).toHaveValue('Keep the current name.\nDo not migrate.');

  // Dragging the card within its lane is still allowed while its answer is being edited.
  const source = await page
    .locator('.card__answer[data-task-id="12"]')
    .locator('..')
    .locator('.grip')
    .boundingBox();
  const target = await task(page, 13).boundingBox();
  if (!source || !target) throw new Error('Could not measure the pending task drag.');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 20, source.y + source.height / 2 + 8, {
    steps: 4,
  });
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(answerBox).toHaveValue('Keep the current name.\nDo not migrate.');

  // Selecting another card opens its details without clearing this draft.
  await task(page, 13).click();
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Check the board display');
  await expect(answerBox).toHaveValue('Keep the current name.\nDo not migrate.');
  await task(page, 12).click();
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Restore a board from JSON');

  // Cancel clears the typed text; the request is still waiting and the form stays on the card.
  await request(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(answerBox).toHaveValue('');
  expect(show(12).agentStatus).toBe('pending');
  await answerBox.fill('Keep the current name.\nDo not migrate.');
  await send.click();

  // The card is Idle, the request is gone, and the answer is in the detail history.
  await expect(request(page)).toHaveCount(0);
  await expect(lane(page, 'Doing').getByRole('button', { name: /^#12 AI Idle Restore a board from JSON / })).toBeVisible();
  await panel.getByRole('tab', { name: /^History/ }).click();
  const newest = panel.getByRole('tabpanel').getByRole('listitem').first();
  await expect(newest).toContainText('Do not migrate.');
  await expect(newest.getByRole('img')).toHaveCount(0);
  const stored = show(12);
  expect(stored).toMatchObject({ agentStatus: 'idle', pendingReason: null, pendingRequestId: null });
  expectHistoryNote(stored.history.at(-1), ['Waiting for confirmation on how to replace a board.', 'Keep the current name.\nDo not migrate.']);
});

test('while it is sent the form cannot be sent twice or cancelled; a failure keeps the answer and can be retried', async ({
  page,
}) => {
  await task(page, 12).click();
  let mode: 'fail' | 'hold' | 'pass' = 'fail';
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let posts = 0;
  await page.route('**/api/projects/*/tasks/12/answer', async (route) => {
    posts += 1;
    if (mode === 'fail') {
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'database_error', reason: 'busy' } }) });
    }
    if (mode === 'hold') await gate;
    return route.fallback();
  });
  const box = request(page).getByRole('textbox', { name: 'Your answer' });
  await box.fill('My answer.');
  await request(page).getByRole('button', { name: 'Send', exact: true }).click();

  // Failed: the text and the form stay, the error is announced, and nothing changed.
  await expect(request(page).getByRole('alert')).toHaveText('Could not save. Try again.');
  await expect(box).toHaveValue('My answer.');
  expect(show(12).agentStatus).toBe('pending');

  // Retried while the server is slow: the form is locked and sends once.
  mode = 'hold';
  await request(page).getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(request(page).getByRole('button', { name: 'Sending…' })).toBeDisabled();
  await expect(request(page).getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await expect(box).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(box).toBeVisible();
  expect(posts).toBe(2);
  release();
  await expect(request(page)).toHaveCount(0);
  expect(posts).toBe(2);
  expect(show(12)).toMatchObject({ agentStatus: 'idle' });
  expectHistoryNote(show(12).history.at(-1), ['Waiting for confirmation on how to replace a board.', 'My answer.']);
});

/** A person's move drops the old request; the agent then runs again and asks something else. */
function askAgain(reason: string): void {
  agboardOk(mainProject, ['mv', '12', 'todo', '--actor', 'human', '--reason', 'Back to Todo.']);
  agboardOk(mainProject, ['mv', '12', 'doing', '--actor', 'human', '--reason', 'Doing again.']);
  agboardOk(mainProject, ['state', '12', 'running', '--actor', 'ai', '--reason', 'Moving on.']);
  agboardOk(mainProject, ['state', '12', 'pending', '--actor', 'ai', '--no-wait', '--request-json', decisionJson(reason)]);
}

test('when the agent asks something else while an answer is typed, the page says so, keeps the text, and sends it for the new request only after an edit', async ({
  page,
}) => {
  await task(page, 12).click();
  const box = request(page).getByRole('textbox', { name: 'Your answer' });
  await box.fill('An answer to the old question.');
  const oldRequest = show(12).pendingRequestId;

  // The board refresh is held back while the agent asks again, so the page sees the old request replaced
  // by the new one in one step, as it does when two changes arrive together.
  await page.route('**/api/projects/*/summary', (route) => route.abort());
  askAgain('A different question now.');
  expect(show(12).pendingRequestId).not.toBe(oldRequest);
  await page.unroute('**/api/projects/*/summary');
  agboardOk(mainProject, ['add', 'Triggers a refresh']);

  // The open details hold the stream's updates back; once they are closed, the board is read. The new question
  // is shown on the card, the old answer is kept but cannot be sent as it is.
  await closeForUpdates(
    () => details(page).getByRole('button', { name: 'Close details' }).click(),
    () => expect(request(page)).toContainText('A different question now.', { timeout: 1_500 }),
  );
  await expect(request(page).getByRole('alert')).toHaveText('This request has changed. Review the latest board.');
  await expect(box).toHaveValue('An answer to the old question.');
  await expect(request(page).getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  expect(show(12).history.filter((event) => event.reason.includes('An answer to the old question.'))).toHaveLength(0);

  // Editing the text again confirms it is meant for the new question; then it is sent.
  await box.fill('An answer to the new question.');
  await request(page).getByRole('button', { name: 'Send', exact: true }).click();
  await expect(request(page)).toHaveCount(0);
  expectHistoryNote(show(12).history.at(-1), ['A different question now.', 'An answer to the new question.']);
});

test('an answer sent from a page that missed the new request is refused by the server and not saved', async ({ page }) => {
  await task(page, 12).click();
  const box = request(page).getByRole('textbox', { name: 'Your answer' });
  await box.fill('An answer to the old question.');

  // This page cannot refresh its board, so it still shows the old request when the agent asks again.
  await page.route('**/api/projects/*/summary', (route) => route.abort());
  askAgain('A different question now.');
  await expect(request(page)).toContainText('Waiting for confirmation on how to replace a board.');
  const answered = page.waitForResponse((response) => response.url().endsWith('/tasks/12/answer'));
  await request(page).getByRole('button', { name: 'Send', exact: true }).click();
  expect((await answered).status()).toBe(409);
  await expect(request(page).getByRole('alert')).toHaveText('This request has changed. Review the latest board.');
  await expect(box).toHaveValue('An answer to the old question.');
  // Nothing was saved: still waiting, now with the new question.
  expect(show(12)).toMatchObject({ agentStatus: 'pending', pendingReason: 'A different question now.' });
  expect(show(12).history.filter((event) => event.reason.includes('An answer to the old question.'))).toHaveLength(0);

  // Once the board can be read, the new question appears.
  await page.unroute('**/api/projects/*/summary');
  agboardOk(mainProject, ['add', 'Triggers a refresh']);
  await closeForUpdates(
    () => details(page).getByRole('button', { name: 'Close details' }).click(),
    () => expect(request(page)).toContainText('A different question now.', { timeout: 1_500 }),
  );
  await expect(box).toHaveValue('An answer to the old question.');
});

test('a long reason is cut at four lines, and Show more reads all of it', async ({ page }) => {
  const lines = Array.from({ length: 14 }, (_, index) => `Line ${index + 1} of a long question about the release plan.`);
  agboardOk(mainProject, ['state', '13', 'pending', '--actor', 'ai', '--no-wait', '--request-json', decisionJson(lines.join('\n'))]);
  // The card shows the question as soon as the page hears of it; details opened earlier would hold that back.
  const reason = request(page, 13).locator('p', { hasText: 'Line 1 of a long question' });
  await expect(reason).toBeVisible();
  await task(page, 13).click();
  const lineHeight = await reason.evaluate((element) => parseFloat(getComputedStyle(element).lineHeight));
  expect((await reason.boundingBox())!.height).toBeLessThanOrEqual(lineHeight * 4 + 2);
  const more = request(page, 13).getByRole('button', { name: 'Show more' });
  await expect(more).toBeVisible();
  await more.click();
  await expect(more).toHaveCount(0);
  expect((await reason.boundingBox())!.height).toBeGreaterThan(lineHeight * 10);
  await expect(reason).toContainText('Line 14 of a long question about the release plan.');
  // The answer form is still there after reading it all.
  await expect(request(page, 13).getByRole('button', { name: 'Send', exact: true })).toBeVisible();

  // A short reason has no Show more.
  await task(page, 12).click();
  await expect(request(page).getByRole('button', { name: 'Show more' })).toHaveCount(0);
});
