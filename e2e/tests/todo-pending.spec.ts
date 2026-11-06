import { expect, test, type Page } from '@playwright/test';
import { agboardOk, decisionJson, mainProject, projectId, nextTaskId, resetBoard, type TaskJson } from '../helpers/agboard';
import { waitForSync } from '../helpers/ui';
import { answerButton, answerDialog, answerNote, answerSend, openAnswer } from '../helpers/answer';

// An AI card in Todo can ask a decision before the work starts. It shows as pending in Todo, answers there, and
// returns to Todo idle; a move cancels its request.

const details = (page: Page) => page.getByRole('complementary', { name: 'Task details' });
const task = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });
const lane = (page: Page, name: string) => page.getByRole('region', { name });

function show(id: number): TaskJson & { taskStatus: string; agentStatus: string; pendingRequestId: string | null } {
  return JSON.parse(agboardOk(mainProject, ['show', String(id), '--json']).stdout).task;
}

test.beforeEach(async ({ page }) => {
  resetBoard(mainProject);
  await page.goto(`/?project=${projectId(mainProject)}`);
  await waitForSync(page);
});

test('an AI task in Todo asks, shows as pending there, and the answer returns it to Todo idle', async ({ page }) => {
  const id = nextTaskId(mainProject);
  agboardOk(mainProject, ['add', 'Ask before starting', '--assignee', 'ai', '--actor', 'ai']);
  agboardOk(mainProject, ['state', String(id), 'pending', '--actor', 'ai', '--no-wait', '--request-json', decisionJson('Which plan before we start?')]);
  await page.reload();
  await waitForSync(page);

  // In Todo the card shows its pending state and the answer button, like a card in Doing; the question is in the dialog.
  await expect(lane(page, 'Todo').getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) })).toContainText('Pending');
  await expect(answerButton(page, id)).toBeVisible();
  await expect(lane(page, 'Todo')).not.toContainText('Which plan before we start?');

  await task(page, id).click();
  await expect(await openAnswer(page, id)).toContainText('Which plan before we start?');
  await answerNote(page).fill('Plan A, then review');
  await answerSend(page).click();
  await expect(answerDialog(page)).toBeHidden();
  await expect(answerButton(page, id)).toHaveCount(0);

  // The card is still in Todo, and idle again.
  expect(show(id)).toMatchObject({ taskStatus: 'todo', agentStatus: 'idle', pendingRequestId: null });
  await expect(lane(page, 'Todo').getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) })).not.toContainText('Pending');
});

test('moving a task out of Todo cancels its pending question', async ({ page }) => {
  const id = nextTaskId(mainProject);
  agboardOk(mainProject, ['add', 'Move while asking', '--assignee', 'ai', '--actor', 'ai']);
  agboardOk(mainProject, ['state', String(id), 'pending', '--actor', 'ai', '--no-wait', '--request-json', decisionJson('Still wanted?')]);
  await page.reload();
  await waitForSync(page);
  agboardOk(mainProject, ['mv', String(id), 'doing', '--actor', 'human', '--reason', 'Start now.']);
  await page.reload();
  await waitForSync(page);
  expect(show(id)).toMatchObject({ taskStatus: 'doing', agentStatus: 'idle', pendingRequestId: null });
  await expect(lane(page, 'Doing').getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) })).not.toContainText('Pending');
});
