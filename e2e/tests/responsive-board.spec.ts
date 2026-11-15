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

test('the layout changes at 768px: 767px shows the phone screen and 768px the lanes', async ({ page }) => {
  await page.setViewportSize({ width: 767, height: 900 });
  await expect(phoneSummary(page)).toBeVisible();
  await expect(lane(page, 'Doing')).toHaveCount(0);

  await page.setViewportSize({ width: 768, height: 900 });
  await expect(lane(page, 'Doing')).toBeVisible();
  await expect(phoneSummary(page)).toHaveCount(0);
  await waitForSync(page);
});

const band = (page: Page) => page.getByRole('region', { name: 'Unanswered questions' });

/** The top of the phone screen's task list, which the summary buttons point at. */
async function listTop(page: Page): Promise<number> {
  const id = await phoneSummary(page).getByRole('button').first().getAttribute('aria-controls');
  const box = await page.locator(`[id="${id}"]`).boundingBox();
  if (!box) throw new Error('the task list has no box');
  return box.y;
}

test('on a phone the band is left out with no questions and comes in with one, and the PC band keeps its height', async ({ page }) => {
  // The fixture's open question on #12 is withdrawn, so the project has none.
  agboardOk(mainProject, ['qa', 'withdraw', '0123456789abcdef0123456789abcdef', '--actor', 'ai', '--reason', 'Not needed.']);
  await expect(band(page).getByText('No unanswered questions')).toBeVisible();
  // With no questions the PC band keeps the height it has with one, so the lanes do not move.
  const pcEmpty = await band(page).boundingBox();
  const laneEmpty = await lane(page, 'Doing').boundingBox();

  await page.setViewportSize(PHONE);
  await expect(phoneSummary(page)).toBeVisible();
  await expect(band(page)).toHaveCount(0);
  const summaryBottom = await phoneSummary(page).boundingBox().then((box) => (box ? box.y + box.height : 0));
  const withoutBand = await listTop(page);
  // Nothing sits between the counts and the list.
  expect(withoutBand - summaryBottom).toBeLessThan(40);

  agboardOk(mainProject, ['--json', ...askArgs('13', decisionJson('Which way?'))]);
  await expect(band(page)).toBeVisible();
  const bandBox = await band(page).boundingBox();
  if (!bandBox) throw new Error('the band has no box');
  const withBand = await listTop(page);
  expect(withBand).toBeGreaterThanOrEqual(bandBox.y + bandBox.height);
  expect(withBand - withoutBand).toBeGreaterThanOrEqual(bandBox.height);

  await page.setViewportSize(DESKTOP);
  await expect(lane(page, 'Doing')).toBeVisible();
  await expect(phoneSummary(page)).toHaveCount(0);
  await expect(answerButton(page, 13)).toHaveText('Answer the question');
  expect((await band(page).boundingBox())?.height).toBe(pcEmpty?.height);
  expect((await lane(page, 'Doing').boundingBox())?.y).toBe(laneEmpty?.y);
  await waitForSync(page);
});
