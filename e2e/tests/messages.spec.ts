import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { askArgs, agboardOk, decisionJson, mainHome, mainProject, resetBoard, listTasks } from '../helpers/agboard';
import { expect, test } from '../helpers/fixtures';
import { answerDialog, listRow, messageBand, messageList, openMessageList, sendAnswer } from '../helpers/answer';
import { pasteMarkdown, readBoardAfterReset, waitForSync } from '../helpers/ui';

// The messages of the board: a request sent with Ask AI, a plan the AI proposed as drafts and a person starts,
// and the images that travel with a request.

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==',
  'base64',
);

const lane = (page: import('@playwright/test').Page, name: string) => page.getByRole('region', { name });

type Listed = { id: string; body: string; status: string };

function messages(type: 'question' | 'request'): Listed[] {
  const out = agboardOk(mainProject, ['message', 'ls', '--type', type, '--status', 'all', '--json']).stdout;
  return JSON.parse(out).messages;
}

test.beforeEach(async ({ page }) => {
  resetBoard(mainProject);
  await page.goto('/');
  await waitForSync(page);
  await readBoardAfterReset(page);
});

test('a request sent with Ask AI waits in the Messages band until it is picked up or withdrawn', async ({ page }) => {
  const band = messageBand(page);
  const mine = band.getByRole('listitem').filter({ hasText: /^Your requests/ });
  await expect(mine).toContainText('0');
  await expect(mine).not.toContainText('waiting to be picked up');

  await page.getByRole('button', { name: 'Ask AI', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Ask AI' });
  const editor = dialog.getByRole('textbox', { name: 'What would you like done?' });
  await pasteMarkdown(editor, 'Add a reset link to the login page.');
  await expect(editor).toContainText('Add a reset link to the login page.');
  // The editor hands its text to the form a moment after the paste, so a click that comes first is refused.
  await expect(async () => {
    await dialog.getByRole('button', { name: 'Send request' }).click({ timeout: 1_000 });
    await expect(dialog).toBeHidden({ timeout: 2_000 });
  }).toPass({ timeout: 10_000 });

  // The band counts it as the person's own request, waiting for an AI; it is a message, not a task.
  await expect(mine).toContainText('1');
  await expect(mine).toContainText('waiting to be picked up');
  const [request] = messages('request');
  expect(request).toMatchObject({ body: expect.stringContaining('Add a reset link to the login page.'), status: 'open' });
  expect(listTasks(mainProject).some((task) => task.title.includes('reset link'))).toBe(false);

  // The list shows it on its own tab, and its detail offers Withdraw.
  const list = await openMessageList(page);
  await list.getByRole('tab', { name: /^Your requests/ }).click();
  await expect(listRow(page, /^Request You → AI/)).toContainText('Waiting to be picked up');
  await listRow(page, /^Request You → AI/).click();
  await expect(answerDialog(page)).toContainText('Add a reset link to the login page.');
  await answerDialog(page).getByRole('button', { name: 'Withdraw' }).click();

  await expect(answerDialog(page).getByRole('tab', { name: /^Your requests/ })).toBeVisible();
  await expect(listRow(page, /^Request You → AI/)).toHaveCount(0);
  expect(messages('request')[0].status).toBe('withdrawn');
});

test('a count in the band opens the list on its own tab', async ({ page }) => {
  agboardOk(mainProject, ['message', 'send', '--actor', 'human', '--text', 'Add a reset link to the login page.']);
  await readBoardAfterReset(page);

  await messageBand(page).getByRole('button', { name: /^Your requests/ }).click();
  await expect(messageList(page).getByRole('tab', { name: /^Your requests/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(messageList(page)).toBeHidden();

  await messageBand(page).getByRole('button', { name: /^AI's questions/ }).click();
  await expect(messageList(page).getByRole('tab', { name: /^AI's questions/ })).toHaveAttribute('aria-selected', 'true');
});

test('the pictures sent with a request show in its detail from the message attachment route', async ({ page }) => {
  const picture = path.join(mainHome(), 'login.png');
  writeFileSync(picture, png);
  agboardOk(mainProject, ['message', 'send', '--actor', 'human', '--text', 'The login page looks like this:\n\n![login](attachments/login.png)', '--image', picture]);
  await readBoardAfterReset(page);

  const [request] = messages('request');
  await openMessageList(page);
  const list = page.getByRole('dialog', { name: 'Messages' });
  await list.getByRole('tab', { name: /^Your requests/ }).click();
  await listRow(page, /^Request You → AI/).click();

  const image = answerDialog(page).getByRole('img', { name: 'login' });
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('src', new RegExp(`/messages/${request.id}/attachments/login\\.png$`));
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(answerDialog(page).getByRole('button', { name: 'Withdraw' })).toBeVisible();
});

test('a question without choices is answered in words from its card', async ({ page }) => {
  const id = listTasks(mainProject).find((task) => task.taskStatus === 'doing' && task.assignee === 'ai')!.id;
  agboardOk(mainProject, [
    'message', 'ask', '--actor', 'ai', '--no-wait', '--task', String(id), '--questions-json',
    JSON.stringify({ questions: [{ body: 'What should the page say?' }] }),
  ]);
  await readBoardAfterReset(page);
  await sendAnswer(page, id, { text: 'Say hello.' });
  const asked = messages('question').find((question) => question.body.includes('What should the page say?'));
  expect(asked?.status).toBe('answered');
});
