import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, request as playwrightRequest, test } from '../helpers/fixtures';
import { agboard, askArgs, decisionJson } from '../helpers/agboard';
import { answerDialog, answerSend, askItem, fillAnswer, messageBand, openAnswer, openMessageList, openQuestionCount, phoneBar, send } from '../helpers/answer';
import { closeMessages } from '../helpers/answer-flow';
import {
  createMonitorHome,
  monitorProjectId,
  removeMonitorHome,
  startPhoneEntrance,
  type PhoneEntrance,
} from '../helpers/monitor';

// The board's phone screen through the ngrok entrance: the dedicated loopback backend behind an Edge
// stand-in that names the public Host. The phone has to enter the 4-digit passcode of the run
// before anything is read. How a real Edge forwards a request is NOT exercised here; it stays with
// the real-device and Edge check. No connection to ngrok is made.
test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 375, height: 812 }, locale: 'en-US', timezoneId: 'UTC' });

let home: string;
let alpha: string;
let entrance: PhoneEntrance;

const phoneUrl = (project = alpha) => `${entrance.phoneOrigin}/?project=${project}`;
const wrongCode = () => (entrance.passcode === '0000' ? '0001' : '0000');

test.beforeAll(async () => {
  test.setTimeout(240_000);
  home = createMonitorHome();
  alpha = monitorProjectId(home, 'Alpha');
  entrance = await startPhoneEntrance(home);
});

test.afterAll(async () => {
  await entrance?.stop();
  if (home) removeMonitorHome(home);
});

test('the phone shows no board until the passcode is entered, and a wrong one opens nothing', async ({ page }) => {
  const dataRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (/\/api\/(projects|events)/.test(url.pathname)) dataRequests.push(url.pathname);
  });
  await page.goto(phoneUrl());
  await expect(page.getByRole('heading', { name: 'Enter the passcode' })).toBeVisible();
  const field = page.getByLabel('Passcode');
  const connect = page.getByRole('button', { name: 'Connect' });
  await expect(field).toHaveAttribute('inputmode', 'numeric');
  await expect(connect).toBeDisabled();
  // Only digits are taken, four at most.
  await field.fill('12ab3456');
  await expect(field).toHaveValue('1234');
  // Nothing of the board is on the page, and nothing has asked for it.
  await expect(page.getByRole('article')).toHaveCount(0);
  expect(dataRequests).toEqual([]);

  // A wrong passcode is refused without saying how many tries are left.
  await field.fill(wrongCode());
  await connect.click();
  await expect(page.getByRole('alert')).toContainText('The passcode was not accepted');
  await expect(page.getByRole('alert')).not.toContainText(/\d+ (tries|attempts)/);
  await expect(page.getByRole('article')).toHaveCount(0);
  expect(dataRequests).toEqual([]);
  expect((await page.context().cookies()).filter((cookie) => cookie.name === 'agboard_ngrok_session')).toEqual([]);

  // The right one opens the board, with the session cookie for the whole origin.
  await field.fill(entrance.passcode);
  await connect.click();
  await expect(page.getByRole('status')).toContainText('Connected');
  await expect(page.getByRole('article', { name: /Alpha pending review/ })).toBeVisible();
  const session = (await page.context().cookies()).find((cookie) => cookie.name === 'agboard_ngrok_session');
  expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });

  // Coming back with the cookie goes straight to the board.
  await page.reload();
  await expect(page.getByRole('article', { name: /Alpha pending review/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Enter the passcode' })).toHaveCount(0);
});

test('the phone lists the projects and switches between them as the PC does', async ({ page }) => {
  await entrance.open(page, phoneUrl());
  await expect(page.getByRole('article', { name: /Alpha pending review/ })).toBeVisible();
  await expect(page.getByRole('article', { name: /Alpha running one/ })).toBeVisible();
  await expect(page.getByRole('article', { name: /Beta pending review/ })).toHaveCount(0);
  // The header logo comes through the entrance too.
  await expect.poll(() => page.locator('.header__logo img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

  // The project menu lists every project of the PC, and choosing one shows its board and its address.
  const switcher = page.locator('header .project-switcher');
  await expect(switcher).toContainText('Alpha');
  await switcher.click();
  const menu = page.getByRole('menu');
  for (const name of ['Alpha', 'Beta', 'Empty', 'DeleteMe'])
    await expect(menu.getByRole('menuitemradio', { name })).toBeVisible();
  await menu.getByRole('menuitemradio', { name: 'Beta' }).click();
  await expect(page.getByRole('article', { name: /Beta pending review/ })).toBeVisible();
  await expect(page.getByRole('article', { name: /Alpha pending review/ })).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`[?&]project=${monitorProjectId(home, 'Beta')}`));
  await expect(switcher).toContainText('Beta');

  // The same board API is behind the session, and only the entrance checks stand in front of it.
  const bare = await playwrightRequest.newContext();
  expect((await bare.get(`${entrance.phoneOrigin}/api/projects`)).status()).toBe(401);
  await bare.dispose();
});

test('a tablet-wide page through the entrance shows the PC board without the remote connection settings', async ({ page }) => {
  // An iPad is wide enough for the PC layout; the connection is started and stopped on the computer.
  await page.setViewportSize({ width: 1180, height: 820 });
  await entrance.open(page, phoneUrl());
  await expect(page.getByRole('article', { name: /Alpha pending review/ })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Try it' })).toBeVisible();
  await expect(settings.getByText('Remote connection', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('the old monitor addresses are not found, with or without a session, and nothing redirects', async ({ page }) => {
  await entrance.open(page, phoneUrl());
  await expect(page.getByRole('article', { name: /Alpha pending review/ })).toBeVisible();
  const session = (await page.context().cookies()).find((cookie) => cookie.name === 'agboard_ngrok_session');
  expect(session).toBeDefined();
  const bare = await playwrightRequest.newContext();
  const signedIn = await playwrightRequest.newContext({ extraHTTPHeaders: { Cookie: `agboard_ngrok_session=${session!.value}` } });
  for (const path of [
    '/monitor',
    '/monitor/',
    `/monitor/?project=${alpha}`,
    '/monitor/api/session',
    `/monitor/api/projects/${alpha}/summary`,
    `/monitor/api/events?project=${alpha}`,
    '/monitor/assets/monitor/monitor-x.js',
  ]) {
    for (const [who, context] of [['no session', bare], ['session', signedIn]] as const) {
      const response = await context.fetch(`${entrance.phoneOrigin}${path}`, { maxRedirects: 0 });
      expect(response.status(), `${path} (${who})`).toBe(404);
      expect(response.headers()['location'], `${path} (${who})`).toBeUndefined();
    }
  }
  // The bare origin is the board's own page, not a forward to the old address.
  const root = await bare.fetch(`${entrance.phoneOrigin}/`, { maxRedirects: 0 });
  expect(root.status()).toBe(200);
  await bare.dispose();
  await signedIn.dispose();
});

// DM-6: the phone answers from the bottom sheet; the card itself carries only the button.
test('the phone answers a question from the sheet, and the answer reaches the shared files', async ({ page }) => {
  await entrance.open(page, phoneUrl());
  // The phone shows one lane at a time; the card waiting for an answer is in Doing.
  await page.getByRole('tab', { name: /^Doing / }).click();
  const article = page.getByRole('article', { name: /Alpha pending review/ });
  // The card shows the button only: no question, no choices, no note.
  await expect(article.getByRole('button', { name: 'Answer the question' })).toBeVisible();
  await expect(article.getByRole('textbox')).toHaveCount(0);

  const sheet = await openAnswer(page, 1);
  await expect(sheet.getByText('Waiting for the user review.')).toBeVisible();
  // One question, one button: Send answer stays disabled until an option is chosen.
  await expect(answerSend(page)).toBeDisabled();
  await expect(sheet.getByRole('button', { name: 'Send all', exact: true })).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Review and send', exact: true })).toHaveCount(0);

  // Closing without sending (Later) keeps the question open.
  await sheet.getByRole('button', { name: 'Later' }).click();
  await closeMessages(page);
  await expect(article.getByRole('button', { name: 'Answer the question' })).toBeVisible();

  await openAnswer(page, 1);
  await fillAnswer(answerDialog(page), { choice: 'Plan A', text: 'Reviewed on the phone.' });
  const answered = page.waitForResponse((response) =>
    response.url().includes('/messages/answers') && response.request().method() === 'POST');
  await send(page);
  expect((await answered).status()).toBe(200);
  await closeMessages(page);
  await expect(article.getByRole('button', { name: 'Answer the question' })).toHaveCount(0);

  const task = JSON.parse(agboard('Alpha', ['show', '1', '--json'], home).stdout).task as {
    agentStatus: string;
    pendingRequestId: string | null;
    history: { reason: string }[];
  };
  expect(task.pendingRequestId).toBeNull();
  expect(task.agentStatus).toBe('idle');
  expect(task.history.at(-1)?.reason).toContain('Reviewed on the phone.');
});

test('the phone bar counts the open questions; a question picked in its list is answered from the sheet', async ({ page }) => {
  const json = (args: string[]) => JSON.parse(agboard('Alpha', [...args, '--json'], home).stdout);
  await entrance.open(page, phoneUrl());
  // The bottom bar is always there, and Messages carries the number of open questions.
  await expect(phoneBar(page)).toBeVisible();
  await expect(messageBand(page)).toHaveCount(0);
  const countOf = () => openQuestionCount(page);
  await expect.poll(countOf).not.toBeNaN();
  const before = await countOf();
  // Ask sits in the middle of the bar.
  await expect(askItem(page)).toBeVisible();

  const id: number = json(['add', 'Alpha band question', `--desc=Asked for the band.`, '--assignee', 'ai', '--actor', 'human']).task.id;
  agboard('Alpha', ['mv', String(id), 'doing', '--actor', 'ai', '--reason', 'Start'], home);
  const asked = agboard('Alpha', askArgs(String(id), decisionJson('Which plan for the band?')), home);
  expect(asked.code, asked.stderr).toBe(0);
  await expect.poll(countOf).toBe(before + 1);

  // The list's row opens the sheet at its question; Back to list returns to the list with the question still open.
  const list = await openMessageList(page);
  await list.getByRole('button', { name: /Which plan for the band\?/ }).click();
  const sheet = answerDialog(page);
  await sheet.getByRole('radio', { name: 'Plan B' }).click();
  await sheet.getByRole('button', { name: 'Back to list' }).click();
  await closeMessages(page);
  expect(json(['show', String(id)]).task.agentStatus).toBe('pending');

  await openMessageList(page);
  await answerDialog(page).getByRole('button', { name: /Which plan for the band\?/ }).click();
  await fillAnswer(answerDialog(page), { choice: 'Plan B' });
  await send(page);
  await closeMessages(page);
  await expect.poll(countOf).toBe(before);
  const stored = json(['show', String(id)]).task as { agentStatus: string; history: { reason: string }[] };
  expect(stored.agentStatus).toBe('idle');
  expect(stored.history.at(-1)?.reason).toContain('Plan B');
});

test('an image attached to the task shows in the sheet from the attachment route of the board', async ({ page }) => {
  const json = (args: string[]) => JSON.parse(agboard('Alpha', [...args, '--json'], home).stdout);
  const id: number = json(['add', 'Alpha image question', `--desc=A question with a picture.`, '--assignee', 'ai', '--actor', 'human']).task.id;
  agboard('Alpha', ['mv', String(id), 'doing', '--actor', 'ai', '--reason', 'Start review'], home);
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==',
    'base64',
  );
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'agboard-question-image-')), 'question.png');
  writeFileSync(file, png);
  const attachment: string = json(['attachment', 'add', String(id), '--file', file, '--actor', 'ai']).attachment.id;
  const question = `Which one?\n\n![the picture](attachment:${attachment})`;
  const st = agboard('Alpha', askArgs(String(id), decisionJson(question)), home);
  expect(st.code, st.stderr).toBe(0);

  await entrance.open(page, phoneUrl());
  await page.getByRole('tab', { name: /^Doing / }).click();
  await page.getByRole('article', { name: /Alpha image question/ }).getByRole('button', { name: 'Answer the question' }).click();
  const sheet = answerDialog(page);
  const image = sheet.getByRole('img', { name: 'the picture' });
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('src', new RegExp(`/api/projects/${alpha}/tasks/${id}/attachments/${attachment}$`));
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
});

test('an image in a history reason shows in the History tab from the attachment route of the board', async ({ page }) => {
  const json = (args: string[]) => JSON.parse(agboard('Alpha', [...args, '--json'], home).stdout);
  const id: number = json(['add', 'Alpha history evidence', `--desc=A task with evidence.`, '--assignee', 'ai', '--actor', 'human']).task.id;
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==',
    'base64',
  );
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'agboard-history-image-')), 'evidence.png');
  writeFileSync(file, png);
  const added = json(['attachment', 'add', String(id), '--file', file, '--actor', 'ai']);
  const reason = `Checked.\n\n| Screen | Result |\n| --- | --- |\n| Board | Passed |\n\n![the evidence](${added.path})`;
  const noted = agboard('Alpha', ['history', 'add', String(id), `--reason=${reason}`], home);
  expect(noted.code, noted.stderr).toBe(0);

  await entrance.open(page, phoneUrl());
  await page.getByRole('button', { name: 'Alpha history evidence' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: /History/ }).click();
  await expect(dialog.getByRole('cell', { name: 'Passed' })).toBeVisible();
  const image = dialog.getByRole('img', { name: 'the evidence' });
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('src', new RegExp(`/api/projects/${alpha}/tasks/${id}/attachments/${added.attachment.id}$`));
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
});

test('nothing is read or answered without a session, and a replaced tunnel needs a new passcode only from an unregistered browser', async ({ page }) => {
  const bare = await playwrightRequest.newContext();
  const base = `${entrance.phoneOrigin}/api`;
  for (const path of [`/projects/${alpha}/summary`, `/projects/${alpha}/tasks/1/detail`, '/events', '/remote/session']) {
    const response = await bare.get(`${base}${path}`);
    expect(response.status(), path).toBe(401);
    expect((await response.json()).error?.code ?? (await response.json()).code).toBe('session_required');
    expect(response.headers()['set-cookie']).toBeUndefined();
  }
  const forged = await bare.post(`${base}/projects/${alpha}/messages/answers`, {
    headers: { Cookie: 'agboard_ngrok_session=' + '0'.repeat(64), 'X-Agboard-Csrf': '0'.repeat(64) },
    data: { answers: [{ questionId: 'Q-1', text: 'forged' }] },
  });
  expect(forged.status()).toBe(401);
  await bare.dispose();

  // A real session reads; after the tunnel is replaced the same cookie reads nothing.
  await entrance.open(page, phoneUrl());
  await expect(page.getByRole('article', { name: /Alpha running one/ })).toBeVisible();
  const cookies = await page.context().cookies();
  const session = cookies.find((cookie) => cookie.name === 'agboard_ngrok_session');
  expect(session).toBeDefined();
  const old = await playwrightRequest.newContext({
    extraHTTPHeaders: { Cookie: `agboard_ngrok_session=${session!.value}` },
  });
  expect((await old.get(`${base}/projects/${alpha}/summary`)).status()).toBe(200);
  await entrance.rotate();
  expect((await old.get(`${base}/projects/${alpha}/summary`)).status()).toBe(401);
  await old.dispose();

  // A browser that was never registered has to enter the passcode of the new run.
  const stranger = await page.context().browser()!.newContext();
  const strangerPage = await stranger.newPage();
  await strangerPage.goto(phoneUrl());
  await expect(strangerPage.getByRole('heading', { name: 'Enter the passcode' })).toBeVisible();
  await expect(strangerPage.getByRole('article')).toHaveCount(0);
  await entrance.unlockPage(strangerPage);
  await expect(strangerPage.getByRole('article', { name: /Alpha running one/ })).toBeVisible();
  await stranger.close();

  // The first page entered the passcode earlier, so its device is registered: it comes back to the
  // new run by itself, without the passcode.
  await page.goto(phoneUrl());
  await expect(page.getByRole('article', { name: /Alpha running one/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Enter the passcode' })).toHaveCount(0);

  // Stopped, the phone can read nothing.
  await entrance.stopTunnel();
  const closed = await page.goto(phoneUrl());
  expect(closed?.status()).toBeGreaterThanOrEqual(500);
  await expect(page.getByRole('article')).toHaveCount(0);
});

test('five wrong passcodes close the run, even to the right one, until the connection starts again', async ({ page }) => {
  // The tunnel was stopped by the last test; a restart is a new run with a new passcode.
  await entrance.restart();
  await page.goto(phoneUrl());
  const field = page.getByLabel('Passcode');
  const connect = page.getByRole('button', { name: 'Connect' });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await field.fill(wrongCode());
    await connect.click();
    await expect(page.getByRole('alert')).toContainText('The passcode was not accepted');
  }
  // The right passcode now gets the same closed door, and the form closes.
  await field.fill(entrance.passcode);
  await connect.click();
  await expect(page.getByRole('alert')).toContainText('Too many wrong passcodes');
  await expect(field).toBeDisabled();
  await expect(connect).toBeDisabled();
  await expect(page.getByRole('article')).toHaveCount(0);
  expect((await page.context().cookies()).filter((cookie) => cookie.name === 'agboard_ngrok_session')).toEqual([]);

  // Reloading does not help; starting the connection again does.
  await page.reload();
  await field.fill(entrance.passcode);
  await connect.click();
  await expect(page.getByRole('alert')).toContainText('Too many wrong passcodes');
  await entrance.rotate();
  await page.reload();
  await entrance.unlockPage(page);
  await expect(page.getByRole('article', { name: /Alpha pending review/ })).toBeVisible();
});
