import fs from 'node:fs';
import { expect, test, type Page } from '../helpers/fixtures';
import { agboardOk, mainProject, projectId as projectIdOf, resetBoard, type TaskJson } from '../helpers/agboard';
import { readBoardAfterReset, waitForSync } from '../helpers/ui';
import { answerDialog, fillAnswer, openAnswer, send } from '../helpers/answer';

// A picture attached to an answer is saved with the question, shown in the answer, and read by the agent.

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==',
  'base64',
);

interface Reply {
  choiceId: string | null;
  text: string | null;
  images: string[];
  imagePaths: string[];
}

function pendingId(id: number): string {
  const task: TaskJson = JSON.parse(agboardOk(mainProject, ['show', String(id), '--json']).stdout).task;
  if (!task.pendingRequestId) throw new Error('The task asks nothing.');
  return task.pendingRequestId;
}

function replyOf(questionId: string): Reply {
  const shown = JSON.parse(agboardOk(mainProject, ['message', 'show', questionId, '--json']).stdout);
  return shown.question.reply;
}

async function attach(page: Page, name: string): Promise<void> {
  const dialog = answerDialog(page);
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Image', exact: true }).click();
  await (await chooser).setFiles({ name, mimeType: 'image/png', buffer: png });
  await expect(dialog.getByRole('button', { name: `Remove ${name}` })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  resetBoard(mainProject);
  await page.goto('/');
  await waitForSync(page);
  await readBoardAfterReset(page);
});

test('an answer with options carries a picture that the agent reads with message show', async ({ page }) => {
  const questionId = pendingId(12);
  const dialog = await openAnswer(page);
  await fillAnswer(dialog, { choice: 'Keep compatibility (recommended)' });
  await attach(page, 'before.png');
  await attach(page, 'after.png');
  await dialog.getByRole('button', { name: 'Remove before.png' }).click();
  await send(page);

  const reply = replyOf(questionId);
  expect(reply.images).toEqual(['after.png']);
  expect(reply.imagePaths).toHaveLength(1);
  expect(fs.readFileSync(reply.imagePaths[0]!).equals(png)).toBe(true);
  // The picture is served from the question's own route, like the images of a request.
  const base = new URL(page.url()).origin;
  const projectId = projectIdOf(mainProject);
  const served = await page.request.get(`${base}/api/projects/${projectId}/messages/${questionId}/attachments/after.png`);
  expect(served.status()).toBe(200);
  expect(served.headers()['content-type']).toBe('image/png');
});

test('a refused picture is not saved and leaves the question open', async ({ page }) => {
  const questionId = pendingId(12);
  const dialog = await openAnswer(page);
  await fillAnswer(dialog, { choice: 'Keep compatibility (recommended)' });
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Image', exact: true }).click();
  await (await chooser).setFiles({ name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  const refused = page.waitForResponse((response) => response.url().endsWith('/messages/answers/multipart'));
  await dialog.getByRole('button', { name: 'Send answer' }).click();
  expect((await refused).status()).toBe(422);
  await expect(dialog.getByRole('alert')).toBeVisible();
  expect(JSON.parse(agboardOk(mainProject, ['message', 'show', questionId, '--json']).stdout).question.reply).toBeNull();
});
