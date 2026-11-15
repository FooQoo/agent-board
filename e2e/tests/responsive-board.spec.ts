import { expect, test, type Page } from '../helpers/fixtures';
import { agboardOk, askArgs, decisionJson, mainProject, projectId, resetBoard, type TaskJson } from '../helpers/agboard';
import { answerButton, bandCount, bandToggle, expandBand, fillAnswer, openAnswer, questionBand, send } from '../helpers/answer';
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

test('the band is always there: with no question its header shows a count of 0 and nothing opens, at desktop and phone widths', async ({ page }) => {
  // The fixture's open question on #12 is withdrawn, so the project has none.
  agboardOk(mainProject, ['qa', 'withdraw', '0123456789abcdef0123456789abcdef', '--actor', 'ai', '--reason', 'Not needed.']);
  for (const size of [DESKTOP, PHONE, DESKTOP]) {
    await page.setViewportSize(size);
    await expect(band(page)).toBeVisible();
    await expect(bandCount(page)).toHaveText('0');
    await expect(bandToggle(page)).toBeDisabled();
    await expect(band(page).getByRole('listitem')).toHaveCount(0);
    await expect(band(page).getByRole('status')).toHaveCount(0);
    await expect(band(page).getByRole('button', { name: 'Answer them' })).toHaveCount(0);
  }
  if ((await phoneSummary(page).count()) === 0) await page.setViewportSize(PHONE);
  await expect(phoneSummary(page)).toBeVisible();
  const summaryBottom = await phoneSummary(page).boundingBox().then((box) => (box ? box.y + box.height : 0));
  const bandBox = await band(page).boundingBox();
  if (!bandBox) throw new Error('the band has no box');
  // The header sits under the counts, and the list follows it.
  expect(bandBox.y).toBeGreaterThanOrEqual(summaryBottom - 1);
  expect(await listTop(page)).toBeGreaterThanOrEqual(bandBox.y + bandBox.height);

  // A question that arrives is counted at once, and the band stays closed.
  agboardOk(mainProject, ['--json', ...askArgs('13', decisionJson('Which way?'))]);
  await expect(bandCount(page)).toHaveText('1');
  await expect(bandToggle(page)).toBeEnabled();
  await expect(bandToggle(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(band(page).getByRole('listitem')).toHaveCount(0);
  await page.setViewportSize(DESKTOP);
  await waitForSync(page);
});

for (const [name, size] of [
  ['desktop', DESKTOP],
  ['phone', PHONE],
] as const) {
  test(`the band starts closed at ${name} width: the count and Answer them show, and its header opens and closes the cards`, async ({ page }) => {
    await page.setViewportSize(size);
    await expect(band(page)).toBeVisible();
    await expect(bandCount(page)).toHaveText('1');
    const toggle = bandToggle(page);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(band(page).getByRole('listitem')).toHaveCount(0);
    await expect(band(page).getByRole('button', { name: 'Answer them' })).toBeVisible();
    await expect(band(page).getByRole('button', { name: 'Show the later questions' })).toHaveCount(0);

    await expect(toggle).toBeVisible();
    const closedHeight = (await band(page).boundingBox())?.height ?? 0;
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(band(page).getByRole('listitem')).toHaveCount(1);
    await expect(band(page).getByRole('listitem').first()).toBeVisible();
    await expect(bandCount(page)).toHaveText('1');
    await expect(band(page).getByRole('button', { name: 'Answer them' })).toBeVisible();
    expect((await band(page).boundingBox())?.height ?? 0).toBeGreaterThan(closedHeight);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(band(page).getByRole('listitem')).toHaveCount(0);
    expect((await band(page).boundingBox())?.height).toBe(closedHeight);

    // A reload does not remember the choice: the band starts closed again.
    await toggle.click();
    await page.reload();
    await expect(bandToggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(questionBand(page).getByRole('listitem')).toHaveCount(0);
    await expandBand(page);
    await page.setViewportSize(DESKTOP);
    await waitForSync(page);
  });
}
