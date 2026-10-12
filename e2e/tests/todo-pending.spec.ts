import { expect, test, type Page } from '@playwright/test';
import { agboardOk, decisionJson, mainProject, nextCardId, resetBoard, type CardJson } from '../helpers/agboard';
import { waitForSync } from '../helpers/ui';

// An AI card in Todo can ask a decision before the work starts. It shows as pending in Todo, answers there, and
// returns to Todo idle; a move cancels its request.

const details = (page: Page) => page.getByRole('complementary', { name: 'Card details' });
const card = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });
const lane = (page: Page, name: string) => page.getByRole('region', { name });
const request = (page: Page, id: number) =>
  page.locator(`.card__answer[data-card-id="${id}"]`).getByRole('region', { name: 'The agent is waiting for your answer' });

function show(id: number): CardJson & { cardStatus: string; agentStatus: string; pendingRequestId: string | null } {
  return JSON.parse(agboardOk(mainProject, ['show', String(id), '--json']).stdout).card;
}

test.beforeEach(async ({ page }) => {
  resetBoard(mainProject);
  await page.goto('/');
  await waitForSync(page);
});

test('an AI card in Todo asks, shows as pending there, and the answer returns it to Todo idle', async ({ page }) => {
  const id = nextCardId(mainProject);
  agboardOk(mainProject, ['add', 'Ask before starting', '--assignee', 'ai', '--actor', 'ai']);
  agboardOk(mainProject, ['state', String(id), 'pending', '--actor', 'ai', '--request-json', decisionJson('Which plan before we start?')]);
  await page.reload();
  await waitForSync(page);

  // In Todo the card shows its pending state and the question, like a card in Doing.
  await expect(lane(page, 'Todo').getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) })).toContainText('Pending');
  await expect(lane(page, 'Todo')).toContainText('Which plan before we start?');

  await card(page, id).click();
  await expect(request(page, id)).toContainText('Which plan before we start?');
  const answer = request(page, id).getByRole('textbox', { name: 'Your answer' });
  await answer.fill('Plan A, then review');
  await request(page, id).getByRole('button', { name: 'Send', exact: true }).click();
  await expect(request(page, id)).toHaveCount(0);

  // The card is still in Todo, and idle again.
  expect(show(id)).toMatchObject({ cardStatus: 'todo', agentStatus: 'idle', pendingRequestId: null });
  await expect(lane(page, 'Todo').getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) })).not.toContainText('Pending');
});

test('moving a card out of Todo cancels its pending question', async ({ page }) => {
  const id = nextCardId(mainProject);
  agboardOk(mainProject, ['add', 'Move while asking', '--assignee', 'ai', '--actor', 'ai']);
  agboardOk(mainProject, ['state', String(id), 'pending', '--actor', 'ai', '--request-json', decisionJson('Still wanted?')]);
  await page.reload();
  await waitForSync(page);
  agboardOk(mainProject, ['mv', String(id), 'doing', '--actor', 'human', '--reason', 'Start now.']);
  await page.reload();
  await waitForSync(page);
  expect(show(id)).toMatchObject({ cardStatus: 'doing', agentStatus: 'idle', pendingRequestId: null });
  await expect(lane(page, 'Doing').getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) })).not.toContainText('Pending');
});
