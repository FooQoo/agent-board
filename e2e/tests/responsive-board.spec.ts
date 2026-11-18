import { expect, test, type Page } from '../helpers/fixtures';
import { agboardOk, askArgs, decisionJson, mainProject, projectId, resetBoard, type TaskJson } from '../helpers/agboard';
import { answerButton, answerDialog, fillAnswer, messageBand, messageList, openAnswer, openListButton, openMessageList, send } from '../helpers/answer';
import { closeMessages } from '../helpers/answer-flow';
import { readBoardAfterReset, waitForSync } from '../helpers/ui';

// One app serves both layouts: below 768px the board shows the phone screen, at and above it the lanes.
// The phone screen reads and writes through the board's own routes, so an answer sent from it reaches the CLI.

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

const lane = (page: Page, name: string) => page.getByRole('region', { name });
const phoneTabs = (page: Page) => page.getByRole('tablist', { name: 'Lanes' });

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
  await expect(phoneTabs(page)).toBeVisible();
  await expect(lane(page, 'Doing')).toHaveCount(0);
  // The project the PC showed is the one on the phone.
  await expect(page.getByRole('button', { name: 'agent-board' })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('project')).toBe(projectId(mainProject));

  // The phone shows one lane at a time; #13 is in Doing.
  await page.getByRole('tab', { name: /^Doing / }).click();
  const dialog = await openAnswer(page, 13);
  await fillAnswer(dialog, { choice: 'Plan A', text: 'From the phone' });
  await send(page);
  await closeMessages(page);
  await expect(answerButton(page, 13)).toHaveCount(0);
  expect(show(13).agentStatus).toBe('idle');

  await page.setViewportSize(DESKTOP);
  await expect(lane(page, 'Doing')).toBeVisible();
  await expect(phoneTabs(page)).toHaveCount(0);
  await waitForSync(page);
});

test('the layout changes at 768px: 767px shows the phone screen and 768px the lanes', async ({ page }) => {
  await page.setViewportSize({ width: 767, height: 900 });
  await expect(phoneTabs(page)).toBeVisible();
  await expect(lane(page, 'Doing')).toHaveCount(0);

  await page.setViewportSize({ width: 768, height: 900 });
  await expect(lane(page, 'Doing')).toBeVisible();
  await expect(phoneTabs(page)).toHaveCount(0);
  await waitForSync(page);
});

const band = messageBand;
const chip = (page: Page, name: RegExp) => band(page).getByRole('listitem').filter({ hasText: name });

/** The open questions of the fixture board are withdrawn, so the project has none. */
function withdrawOpenQuestions(): void {
  const listed = JSON.parse(agboardOk(mainProject, ['message', 'ls', '--type', 'question', '--status', 'open', '--json']).stdout) as {
    messages: { id: string }[];
  };
  for (const { id } of listed.messages) agboardOk(mainProject, ['message', 'withdraw', id, '--actor', 'ai']);
}

/** The top of the phone screen's task list, which the lane tabs point at. */
async function listTop(page: Page): Promise<number> {
  const id = await phoneTabs(page).getByRole('tab').first().getAttribute('aria-controls');
  const box = await page.locator(`[id="${id}"]`).boundingBox();
  if (!box) throw new Error('the task list has no box');
  return box.y;
}

test('the band is always there: with no message it shows counts of 0 and the list opens empty, at desktop and phone widths', async ({ page }) => {
  withdrawOpenQuestions();
  for (const size of [DESKTOP, PHONE, DESKTOP]) {
    await page.setViewportSize(size);
    await expect(band(page)).toBeVisible();
    await expect(chip(page, /^AI's questions/)).toHaveText(/^AI's questions 0$/);
    await expect(chip(page, /^Your requests/)).toHaveText(/^Your requests 0$/);
    await expect(openListButton(page)).toBeEnabled();
  }
  if ((await phoneTabs(page).count()) === 0) await page.setViewportSize(PHONE);
  await expect(phoneTabs(page)).toBeVisible();
  const tabsBox = await phoneTabs(page).boundingBox();
  const bandBox = await band(page).boundingBox();
  if (!bandBox || !tabsBox) throw new Error('the band or the lane tabs have no box');
  // The band sits above the lane tabs, and the lane's list follows them.
  expect(tabsBox.y).toBeGreaterThanOrEqual(bandBox.y + bandBox.height - 1);
  expect(await listTop(page)).toBeGreaterThanOrEqual(tabsBox.y + tabsBox.height - 1);

  // An empty list opens, and closes without a change.
  const list = await openMessageList(page);
  await expect(list.getByRole('tab', { name: /^AI's questions 0/ })).toBeVisible();
  await expect(list.getByRole('tab', { name: /^Your requests 0/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(messageList(page)).toBeHidden();

  // A question that arrives is counted at once, and nothing opens by itself.
  agboardOk(mainProject, ['--json', ...askArgs('13', decisionJson('Which way?'))]);
  await expect(chip(page, /^AI's questions/)).toHaveText(/^AI's questions 1$/);
  await expect(messageList(page)).toHaveCount(0);
  await page.setViewportSize(DESKTOP);
  await waitForSync(page);
});

for (const [name, size] of [
  ['desktop', DESKTOP],
  ['phone', PHONE],
] as const) {
  test(`the band shows the counts at ${name} width, and Check questions and requests opens and closes the list`, async ({ page }) => {
    await page.setViewportSize(size);
    await expect(band(page)).toBeVisible();
    // The fixture's open question and the proposed plan's question are counted.
    await expect(chip(page, /^AI's questions/)).toContainText(/^AI's questions [1-9]/);
    await expect(chip(page, /^Your requests/)).toHaveText(/^Your requests 0$/);
    await expect(messageList(page)).toHaveCount(0);
    if (name === 'phone') await expect(band(page).getByRole('button', { name: 'Ask AI' })).toBeVisible();
    else await expect(band(page).getByRole('button', { name: 'Ask AI' })).toHaveCount(0);

    const list = await openMessageList(page);
    await expect(list.getByRole('tab', { name: /^AI's questions/ })).toBeVisible();
    await expect(list.getByRole('tab', { name: /^Your requests/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(messageList(page)).toBeHidden();

    // A reload does not remember anything: the list starts closed again.
    await openMessageList(page);
    await page.reload();
    await expect(band(page)).toBeVisible();
    await expect(messageList(page)).toHaveCount(0);
    await page.setViewportSize(DESKTOP);
    await waitForSync(page);
  });
}

for (const [name, size] of [
  ['desktop', DESKTOP],
  ['phone', PHONE],
] as const) {
  test(`a question picked in the list opens only that question at ${name} width, and Send answer answers it alone`, async ({ page }) => {
    await page.setViewportSize(size);
    // The fixture's #12 already waits on a question; #13 gets a second one.
    const before = await chip(page, /^AI's questions/).innerText();
    agboardOk(mainProject, ['--json', ...askArgs('13', decisionJson('Which way?'))]);
    const countOf = (text: string) => Number(/AI's questions\s+(\d+)/.exec(text)?.[1] ?? NaN);
    await expect.poll(async () => countOf(await chip(page, /^AI's questions/).innerText())).toBe(countOf(before) + 1);
    const total = countOf(before) + 1;

    const list = await openMessageList(page);
    await list.getByRole('button', { name: /Which way\?/ }).click();
    const dialog = answerDialog(page);
    await expect(dialog.getByRole('region', { name: 'Your answer' })).toBeVisible();
    // One question, one Send answer: there is no Next, no Review and send, and no Send all.
    await expect(dialog.getByRole('button', { name: 'Send answer', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Review and send', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Send all', exact: true })).toHaveCount(0);
    await fillAnswer(dialog, { choice: 'Plan A', text: 'Only this one.' });
    await send(page);
    await closeMessages(page);

    // Only #13 was answered; #12 still waits, and the band's count dropped by one.
    expect(show(13)).toMatchObject({ agentStatus: 'idle', pendingRequestId: null });
    expect(show(12).agentStatus).toBe('pending');
    await expect.poll(async () => countOf(await chip(page, /^AI's questions/).innerText())).toBe(total - 1);
    await expect(answerButton(page, 12)).toBeVisible();
    await page.setViewportSize(DESKTOP);
    await waitForSync(page);
  });
}
