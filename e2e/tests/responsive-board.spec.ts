import { expect, test, type Page } from '../helpers/fixtures';
import { agboardOk, askArgs, decisionJson, mainProject, projectId, resetBoard, type TaskJson } from '../helpers/agboard';
import { answerButton, fillAnswer, openAnswer, send } from '../helpers/answer';
import { readBoardAfterReset, waitForSync } from '../helpers/ui';

// One app serves both layouts: below 768px the board shows the phone screen, at and above it the lanes.
// The phone screen reads and writes through the board's own routes, so an answer sent from it reaches the CLI.

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

const lane = (page: Page, name: string) => page.getByRole('region', { name });
const phoneSummary = (page: Page) => page.getByRole('region', { name: 'Work summary' });

function show(id: number): TaskJson {
  return JSON.parse(agboardOk(mainProject, ['show', String(id), '--json']).stdout).task;
}

test.beforeEach(async ({ page }) => {
  resetBoard(mainProject);
  await page.setViewportSize(DESKTOP);
  await page.goto('/');
  await waitForSync(page);
  await readBoardAfterReset(page);
});

test('a phone-width window shows the phone screen, answers from it, and the lanes return at desktop width', async ({ page }) => {
  agboardOk(mainProject, ['--json', ...askArgs('13', decisionJson('Which way?'))]);
  await expect(answerButton(page, 13)).toHaveText('Answer the question');

  await page.setViewportSize(PHONE);
  await expect(phoneSummary(page)).toBeVisible();
  await expect(lane(page, 'Doing')).toHaveCount(0);
  // The project the PC showed is the one on the phone.
  await expect(page.getByRole('button', { name: 'agent-board' })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('project')).toBe(projectId(mainProject));

  const dialog = await openAnswer(page, 13);
  await fillAnswer(dialog, { text: 'From the phone' });
  await send(page);
  await expect(answerButton(page, 13)).toHaveCount(0);
  expect(show(13).agentStatus).toBe('idle');

  await page.setViewportSize(DESKTOP);
  await expect(lane(page, 'Doing')).toBeVisible();
  await expect(phoneSummary(page)).toHaveCount(0);
  await waitForSync(page);
});
