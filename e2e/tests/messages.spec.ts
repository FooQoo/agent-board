import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { askArgs, agboardOk, decisionJson, mainHome, mainProject, resetBoard, listTasks } from '../helpers/agboard';
import { expect, test } from '../helpers/fixtures';
import { answerDialog, listRow, messageBand, openMessageList, sendAnswer } from '../helpers/answer';
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

test('an AI proposed plan is one card until a person starts it, and an open question blocks the start', async ({ page }) => {
  agboardOk(mainProject, ['epic', 'add', 'RESET', '--name', 'Reset link', '--actor', 'ai']);
  const first = JSON.parse(
    agboardOk(mainProject, ['add', 'Add the reset form', '--assignee', 'ai', '--actor', 'ai', '--epic', 'RESET', '--desc', 'The form.', '--json']).stdout,
  ).task.id as number;
  const second = JSON.parse(
    agboardOk(mainProject, ['add', 'Check the reset mail', '--assignee', 'human', '--actor', 'ai', '--epic', 'RESET', '--desc', 'The mail.', '--json']).stdout,
  ).task.id as number;
  const openBefore = messages('question').filter((question) => question.status === 'open').length;
  agboardOk(mainProject, askArgs(first, decisionJson('Which mail provider?')));
  await readBoardAfterReset(page);

  // The drafts are not cards: one dashed card at the top of Todo stands for the plan.
  const card = lane(page, 'Todo').getByRole('group', { name: 'Proposed plan' });
  await expect(card).toContainText('RESET Reset link');
  await expect(card).toContainText('New epic, 2 tasks');
  await expect(card).toContainText('Open questions 1');
  for (const id of [first, second]) {
    await expect(page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) })).toHaveCount(0);
  }
  // The AI cannot start it, and neither can the CLI while the question is open.
  expect(() => agboardOk(mainProject, ['mv', String(first), 'doing', '--actor', 'ai'])).toThrow(/draft/);
  expect(() => agboardOk(mainProject, ['epic', 'start', 'RESET', '--actor', 'human'])).toThrow(/unanswered|question/i);

  // The band counts the plan as an approval next to the question, and its row opens the same review.
  const fromAi = messageBand(page).getByRole('listitem').filter({ hasText: /^AI's questions/ });
  await expect(fromAi).toContainText(`${openBefore + 1} questions`);
  await expect(fromAi).toContainText('1 approval');
  const list = await openMessageList(page);
  await listRow(page, /^Approval AI → You/).click();
  const review = page.getByRole('dialog', { name: 'Review the plan' });
  await expect(review).toBeVisible();
  await expect(review).toContainText('Tasks that will start (in this order)');
  await expect(review).toContainText('Add the reset form');
  await expect(review).toContainText('Check the reset mail');
  await expect(review.getByRole('button', { name: 'Start with this plan' })).toBeDisabled();
  await expect(review).toContainText('Answer the open question to start.');
  await expect(list).toBeHidden();

  // The question opens from the review; once it is answered the plan can start.
  await review.getByRole('button', { name: 'Answer the question' }).click();
  await expect(answerDialog(page).getByRole('region', { name: 'Your answer' })).toBeVisible();
  await answerDialog(page).getByRole('radio', { name: 'Plan A' }).check();
  await answerDialog(page).getByRole('button', { name: 'Send answer' }).click();
  await expect(answerDialog(page).getByRole('region', { name: 'Your answer' })).toHaveCount(0);
  expect(messages('question').find((question) => question.body.includes('Which mail provider?'))?.status).toBe('answered');
  await page.keyboard.press('Escape');
  await expect(answerDialog(page)).toBeHidden();

  await card.getByRole('button', { name: 'Review and start' }).click();
  const start = page.getByRole('dialog', { name: 'Review the plan' }).getByRole('button', { name: 'Start with this plan' });
  await expect(start).toBeEnabled();
  await start.click();

  // The tasks are ordinary cards now, the plan card is gone, and nothing is left to approve.
  await expect(card).toHaveCount(0);
  for (const [id, title] of [[first, 'Add the reset form'], [second, 'Check the reset mail']] as const) {
    await expect(lane(page, 'Todo').getByRole('button', { name: new RegExp(`^#${id} .*${title}`) })).toBeVisible();
  }
  const tasks = listTasks(mainProject).filter((task) => [first, second].includes(task.id));
  expect(tasks.map((task) => (task as unknown as { draft: unknown }).draft)).toEqual([null, null]);
  await expect(fromAi).toContainText('0 approvals');
  await expect(fromAi).toContainText(`${openBefore} question`);
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
