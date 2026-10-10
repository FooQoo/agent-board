import { expect, test, type Page } from '@playwright/test';
import { agboardOk, listCards, mainProject, nextCardId, resetBoard, taskBody, type CardJson } from '../helpers/agboard';
import { startImageServer, type ImageServer } from '../helpers/imageServer';
import { pasteMarkdown, waitForSync } from '../helpers/ui';

// Adding a card in the shared dialog, and answering a decision request in place, on the real page.

interface ShownCard extends CardJson {
  description: string;
  isDraft: boolean;
  history: { kind: string; actor: string; reason: string | null }[];
}

const details = (page: Page) => page.getByRole('complementary', { name: 'Card details' });
const lane = (page: Page, name: string) => page.getByRole('region', { name });
const card = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });
const request = (page: Page) => details(page).getByRole('region', { name: 'The agent is waiting for your answer' });

function show(id: number): ShownCard {
  return JSON.parse(agboardOk(mainProject, ['show', String(id), '--json']).stdout).card;
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
});

// ------------------------------------------------------------------ Adding a card

test('a card is added with a title, the AI as the default owner, and a Markdown body; it is not a draft', async ({
  page,
}) => {
  const id = nextCardId(mainProject);
  await page.getByRole('button', { name: 'Add card' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add card' });
  await expect(dialog).toContainText('Add card');
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
  // The body has the three required headings (the CLI checks them); the pictures are typed as Markdown.
  await pasteMarkdown(
    editor,
    taskBody(`Ship it.\n\n![found](${images.origin}/ok.png)\n\n![lost](${images.origin}/missing.png)`),
  );
  await expect(dialog.getByRole('navigation', { name: 'Outline' }).getByRole('button')).toHaveText([
    '01作業内容',
    '02完了条件と確認結果',
    '03実行記録',
  ]);
  await expect(dialog.getByText(/^\d+ \/ 50,000$/)).not.toHaveText('0 / 50,000');
  await expect(add).toBeEnabled();

  await add.click();
  await expect(dialog).toHaveCount(0);

  // The CLI sees an ordinary new card: Todo, Idle, the AI's, not a draft, with the text as typed.
  const stored = show(id);
  expect(stored).toMatchObject({ title: 'Plan the release', cardStatus: 'todo', agentStatus: 'idle', assignee: 'ai', isDraft: false });
  expect(stored.description).toContain('Ship it.');
  // A pasted picture keeps its alt text and URL; the editor may add a title equal to the alt text.
  expect(stored.description).toContain(`![found](${images.origin}/ok.png`);
  expect(stored.description).toContain(`![lost](${images.origin}/missing.png`);
  await expect(lane(page, 'Todo').getByRole('button', { name: new RegExp(`^#${id} AI Plan the release `) })).toBeVisible();

  // The owner cannot be changed afterwards: the details have no control for it, and neither has the editor.
  await card(page, id).click();
  await expect(details(page).getByRole('radiogroup')).toHaveCount(0);
  await expect(details(page).getByRole('combobox')).toHaveCount(0);
  await details(page).getByRole('button', { name: 'Make draft' }).click();
  await details(page).getByRole('button', { name: 'Edit card' }).click();
  const editing = page.getByRole('dialog', { name: new RegExp(`^#${id} Edit card`) });
  await expect(editing).toBeVisible();
  await expect(editing.getByRole('radiogroup')).toHaveCount(0);
  await expect(editing.getByText('Assignee')).toHaveCount(0);
});

test('a card for the user is added without a body; closing without typing asks nothing', async ({ page }) => {
  const id = nextCardId(mainProject);
  await page.getByRole('button', { name: 'Add card' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add card' });
  await dialog.getByRole('radio', { name: 'User', exact: true }).check();
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill('Check the invoice');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  // No body given: the CLI writes the TASK.md template, so the description is the template, not empty.
  expect(show(id)).toMatchObject({ title: 'Check the invoice', assignee: 'human', isDraft: false, agentStatus: 'idle' });
  expect(show(id).description).toContain('（作業の目的と内容を書く）');
  await card(page, id).click();
  await expect(details(page).getByRole('tabpanel')).toContainText('（作業の目的と内容を書く）');

  await page.getByRole('button', { name: 'Add card' }).click();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect(listCards(mainProject).map((item) => item.id)).toEqual(expect.not.arrayContaining([id + 1]));
});

test('a title or body over the limit cannot be added', async ({ page }) => {
  await page.getByRole('button', { name: 'Add card' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add card' });
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill('Long body');
  await dialog.getByRole('textbox', { name: 'Description (Markdown)' }).click();
  // The counter counts the Markdown the editor writes, so the text is filled up to the limit by reading it.
  const counter = dialog.locator('.editor__counter');
  const shown = async () => Number((await counter.textContent())!.split('/')[0].replace(/,/g, '').trim());
  await page.keyboard.insertText('x'.repeat(50_000));
  await expect.poll(shown).toBeGreaterThan(49_000);
  await page.waitForTimeout(300);
  await page.keyboard.insertText('x'.repeat(50_001 - (await shown())));
  await expect(dialog.getByText('50,001 / 50,000')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
  await expect(dialog.getByText('Over the 50,000-character limit. Remove 1 character.')).toBeVisible();
  await page.keyboard.press('Backspace');
  await expect(dialog.getByRole('button', { name: 'Add', exact: true })).toBeEnabled();
});

// ------------------------------------------------------------------ Answering in place

test('a waiting card shows its request above the tabs, takes the answer in place, and records it', async ({ page }) => {
  await card(page, 12).click();
  const panel = details(page);
  const tabs = (await panel.getByRole('tablist').boundingBox())!;
  const asked = (await request(page).boundingBox())!;
  // The request is above the tabs, and shows the reason and Answer whichever tab is open.
  expect(asked.y + asked.height).toBeLessThanOrEqual(tabs.y + 1);
  await expect(request(page)).toContainText('Waiting for confirmation on how to replace a board.');
  await panel.getByRole('tab', { name: /^History/ }).click();
  await expect(request(page).getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  await panel.getByRole('tab', { name: 'Description' }).click();

  // No dialog: the answer form is part of the request, open at once, and the rest of the page stays usable.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const answerBox = request(page).getByRole('textbox', { name: 'Your answer' });
  const send = request(page).getByRole('button', { name: 'Send', exact: true });
  await expect(send).toBeDisabled();
  await answerBox.fill('   ');
  await expect(send).toBeDisabled();

  // The history can be read while typing, and the typed answer waits.
  await answerBox.fill('Keep the current name.\nDo not migrate.');
  await panel.getByRole('tab', { name: /^History/ }).click();
  await expect(panel.getByRole('tabpanel').getByRole('listitem').first()).toContainText('Waiting for confirmation');
  await expect(answerBox).toHaveValue('Keep the current name.\nDo not migrate.');
  await panel.getByRole('tab', { name: 'Description' }).click();

  // Cancel clears the typed text; the request is still waiting and the form stays open.
  await request(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(answerBox).toHaveValue('');
  expect(show(12).agentStatus).toBe('pending');
  await answerBox.fill('Keep the current name.\nDo not migrate.');
  await send.click();

  // The card is Idle, the request is gone, and the answer is in the history with the person's mark.
  await expect(request(page)).toHaveCount(0);
  await expect(lane(page, 'Doing').getByRole('button', { name: /^#12 AI Idle Restore a board from JSON / })).toBeVisible();
  await panel.getByRole('tab', { name: /^History/ }).click();
  const newest = panel.getByRole('tabpanel').getByRole('listitem').first();
  await expect(newest).toContainText('Do not migrate.');
  await expect(newest.getByRole('img', { name: 'User', exact: true })).toBeVisible();
  const stored = show(12);
  expect(stored).toMatchObject({ agentStatus: 'idle', pendingReason: null, pendingRequestId: null });
  expect(stored.history.at(-1)).toMatchObject({ actor: 'human', reason: 'Keep the current name.\nDo not migrate.' });
});

test('while it is sent the form cannot be sent twice or cancelled; a failure keeps the answer and can be retried', async ({
  page,
}) => {
  await card(page, 12).click();
  let mode: 'fail' | 'hold' | 'pass' = 'fail';
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let posts = 0;
  await page.route('**/api/projects/*/cards/12/answer', async (route) => {
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
  expect(show(12).history.at(-1)?.reason).toBe('My answer.');
});

/** A person's move drops the old request; the agent then runs again and asks something else. */
function askAgain(reason: string): void {
  agboardOk(mainProject, ['mv', '12', 'todo', '--actor', 'human', '--reason', 'Back to Todo.']);
  agboardOk(mainProject, ['mv', '12', 'doing', '--actor', 'human', '--reason', 'Doing again.']);
  agboardOk(mainProject, ['state', '12', 'running', '--actor', 'ai', '--reason', 'Moving on.']);
  agboardOk(mainProject, ['state', '12', 'pending', '--actor', 'ai', '--reason', reason]);
}

test('when the agent asks something else while an answer is typed, the page says so, keeps the text, and sends it for the new request only after an edit', async ({
  page,
}) => {
  await card(page, 12).click();
  const box = request(page).getByRole('textbox', { name: 'Your answer' });
  await box.fill('An answer to the old question.');
  const oldRequest = show(12).pendingRequestId;

  // The board refresh is held back while the agent asks again, so the page sees the old request replaced
  // by the new one in one step, as it does when two changes arrive together.
  await page.route('**/api/projects/*/board', (route) => route.abort());
  askAgain('A different question now.');
  expect(show(12).pendingRequestId).not.toBe(oldRequest);
  await page.unroute('**/api/projects/*/board');
  agboardOk(mainProject, ['add', 'Triggers a refresh']);

  // The page follows the board: the new question is shown, the old answer is kept but cannot be sent as it is.
  await expect(request(page)).toContainText('A different question now.');
  await expect(request(page).getByRole('alert')).toHaveText('This request has changed. Review the latest board.');
  await expect(box).toHaveValue('An answer to the old question.');
  await expect(request(page).getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  expect(show(12).history.filter((event) => event.actor === 'human' && event.reason === 'An answer to the old question.')).toHaveLength(0);

  // Editing the text again confirms it is meant for the new question; then it is sent.
  await box.fill('An answer to the new question.');
  await request(page).getByRole('button', { name: 'Send', exact: true }).click();
  await expect(request(page)).toHaveCount(0);
  expect(show(12).history.at(-1)).toMatchObject({ actor: 'human', reason: 'An answer to the new question.' });
});

test('an answer sent from a page that missed the new request is refused by the server and not saved', async ({ page }) => {
  await card(page, 12).click();
  const box = request(page).getByRole('textbox', { name: 'Your answer' });
  await box.fill('An answer to the old question.');

  // This page cannot refresh its board, so it still shows the old request when the agent asks again.
  await page.route('**/api/projects/*/board', (route) => route.abort());
  askAgain('A different question now.');
  await expect(request(page)).toContainText('Waiting for confirmation on how to replace a board.');
  const answered = page.waitForResponse((response) => response.url().endsWith('/cards/12/answer'));
  await request(page).getByRole('button', { name: 'Send', exact: true }).click();
  expect((await answered).status()).toBe(409);
  await expect(request(page).getByRole('alert')).toHaveText('This request has changed. Review the latest board.');
  await expect(box).toHaveValue('An answer to the old question.');
  // Nothing was saved: still waiting, now with the new question.
  expect(show(12)).toMatchObject({ agentStatus: 'pending', pendingReason: 'A different question now.' });
  expect(show(12).history.filter((event) => event.actor === 'human' && event.reason === 'An answer to the old question.')).toHaveLength(0);

  // Once the board can be read, the new question appears.
  await page.unroute('**/api/projects/*/board');
  agboardOk(mainProject, ['add', 'Triggers a refresh']);
  await expect(request(page)).toContainText('A different question now.');
  await expect(box).toHaveValue('An answer to the old question.');
});

test('a long reason is cut at four lines, and Show more reads all of it', async ({ page }) => {
  const lines = Array.from({ length: 14 }, (_, index) => `Line ${index + 1} of a long question about the release plan.`);
  agboardOk(mainProject, ['state', '13', 'pending', '--actor', 'ai', '--reason', lines.join('\n')]);
  await card(page, 13).click();
  const reason = request(page).locator('p', { hasText: 'Line 1 of a long question' });
  await expect(reason).toBeVisible();
  const lineHeight = await reason.evaluate((element) => parseFloat(getComputedStyle(element).lineHeight));
  expect((await reason.boundingBox())!.height).toBeLessThanOrEqual(lineHeight * 4 + 2);
  const more = request(page).getByRole('button', { name: 'Show more' });
  await expect(more).toBeVisible();
  await more.click();
  await expect(more).toHaveCount(0);
  expect((await reason.boundingBox())!.height).toBeGreaterThan(lineHeight * 10);
  await expect(reason).toContainText('Line 14 of a long question about the release plan.');
  // The answer form is still there after reading it all.
  await expect(request(page).getByRole('button', { name: 'Send', exact: true })).toBeVisible();

  // A short reason has no Show more.
  await card(page, 12).click();
  await expect(request(page).getByRole('button', { name: 'Show more' })).toHaveCount(0);
});
