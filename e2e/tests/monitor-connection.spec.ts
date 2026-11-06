import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, request as playwrightRequest, test } from '@playwright/test';
import { agboard } from '../helpers/agboard';
import {
  createMonitorHome,
  monitorProjectId,
  removeMonitorHome,
  startPhoneEntrance,
  type PhoneEntrance,
} from '../helpers/monitor';

// The phone monitor through the ngrok entrance: the dedicated loopback backend behind an Edge
// stand-in that names the public Host. The phone has to enter the 4-digit passcode of the run
// before anything is read. How a real Edge forwards a request is NOT exercised here; it stays with
// the real-device and Edge check. No connection to ngrok is made.
test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 375, height: 812 }, locale: 'en-US', timezoneId: 'UTC' });

let home: string;
let alpha: string;
let entrance: PhoneEntrance;

const monitorUrl = () => `${entrance.phoneOrigin}/monitor/?project=${alpha}`;
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
    if (/\/monitor\/api\/(projects|events)/.test(url.pathname)) dataRequests.push(url.pathname);
  });
  await page.goto(monitorUrl());
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

  // The right one opens the monitor, with the session cookie scoped to /monitor/.
  await field.fill(entrance.passcode);
  await connect.click();
  await expect(page.getByRole('status')).toContainText('Connected');
  await expect(page.getByRole('article', { name: /Alpha pending review/ })).toBeVisible();
  const session = (await page.context().cookies()).find((cookie) => cookie.name === 'agboard_ngrok_session');
  expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/monitor/' });

  // Coming back with the cookie goes straight to the board.
  await page.reload();
  await expect(page.getByRole('article', { name: /Alpha pending review/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Enter the passcode' })).toHaveCount(0);
});

test('the phone lists the board through the entrance and exposes nothing of the PC board', async ({ page }) => {
  await entrance.open(page, monitorUrl());
  await expect(page.getByRole('status')).toContainText('Connected');
  await expect(page.getByRole('article', { name: /Alpha pending review/ })).toBeVisible();
  await expect(page.getByRole('article', { name: /Alpha running one/ })).toBeVisible();
  await expect(page.getByRole('article', { name: /Alpha ordinary todo/ })).toBeVisible();
  await expect(page.getByRole('article', { name: /Beta pending review/ })).toHaveCount(0);
  // The header logo comes through the entrance too.
  await expect.poll(() => page.locator('.header__logo img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

  // The PC board, its API and the desktop write routes are not behind the entrance.
  const direct = await playwrightRequest.newContext();
  for (const path of ['/api/projects', `/api/projects/${alpha}/tasks/1/move`]) {
    const response = await direct.fetch(`${entrance.phoneOrigin}${path}`, { method: path.endsWith('/move') ? 'POST' : 'GET' });
    expect(response.status(), path).toBe(404);
  }
  // The bare origin only forwards to the monitor page; it shows no board.
  const root = await direct.fetch(`${entrance.phoneOrigin}/`, { maxRedirects: 0 });
  expect(root.status()).toBe(308);
  expect(root.headers()['location']).toBe('/monitor/');
  await direct.dispose();
});

// DM-6: the phone answers from the bottom sheet; the card itself carries only the button.
test('the phone answers the current question from the sheet, and the answer reaches the shared files', async ({ page }) => {
  await entrance.open(page, monitorUrl());
  const article = page.getByRole('article', { name: /Alpha pending review/ });
  // The card shows the button only: no question, no choices, no note.
  await expect(article.getByRole('button', { name: 'Answer the question' })).toBeVisible();
  await expect(article.getByRole('textbox')).toHaveCount(0);
  await expect(article.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0);

  await article.getByRole('button', { name: 'Answer the question' }).click();
  const sheet = page.getByRole('dialog', { name: 'Alpha pending review' });
  await expect(sheet.getByText('Waiting for the user review.')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();

  // Closing without sending keeps the input, and the card then says to continue.
  await sheet.getByRole('textbox').fill('Reviewed on the phone.');
  await sheet.getByRole('button', { name: 'Close the answer', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(article.getByRole('button', { name: 'Continue answering' })).toBeVisible();

  await article.getByRole('button', { name: 'Continue answering' }).click();
  await expect(sheet.getByRole('textbox')).toHaveValue('Reviewed on the phone.');
  await sheet.getByRole('radio', { name: 'Plan A' }).click();
  const answered = page.waitForResponse((response) =>
    response.url().includes('/tasks/1/answer') && response.request().method() === 'POST');
  await sheet.getByRole('button', { name: 'Send', exact: true }).click();
  expect((await answered).status()).toBe(200);
  await expect(sheet).toHaveCount(0);
  await expect(article.getByRole('button', { name: /Answer the question|Continue answering/ })).toHaveCount(0);

  const task = JSON.parse(agboard('Alpha', ['show', '1', '--json'], home).stdout).task as {
    agentStatus: string;
    pendingRequestId: string | null;
    history: { reason: string }[];
  };
  expect(task.pendingRequestId).toBeNull();
  expect(task.agentStatus).toBe('idle');
  expect(task.history.at(-1)?.reason).toContain('Reviewed on the phone.');
});

test('an image attached to the task shows in the sheet from the monitor attachment route', async ({ page }) => {
  const json = (args: string[]) => JSON.parse(agboard('Alpha', [...args, '--json'], home).stdout);
  const id: number = json(['add', 'Alpha image question', '--desc', 'A question with a picture.', '--assignee', 'ai', '--actor', 'ai']).task.id;
  agboard('Alpha', ['mv', String(id), 'doing', '--actor', 'ai', '--reason', 'Start review'], home);
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==',
    'base64',
  );
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'agboard-question-image-')), 'question.png');
  writeFileSync(file, png);
  const attachment: string = json(['attachment', 'add', String(id), '--file', file, '--actor', 'ai']).attachment.id;
  const question = `Which one?\n\n![the picture](attachment:${attachment})`;
  const st = agboard('Alpha', ['state', String(id), 'pending', '--actor', 'ai', '--no-wait', '--request-json', JSON.stringify({ question, choices: [{ id: 'a', label: 'Plan A' }, { id: 'b', label: 'Plan B' }] })], home);
  expect(st.code, st.stderr).toBe(0);

  await entrance.open(page, monitorUrl());
  await page.getByRole('article', { name: /Alpha image question/ }).getByRole('button', { name: 'Answer the question' }).click();
  const sheet = page.getByRole('dialog', { name: 'Alpha image question' });
  const image = sheet.getByRole('img', { name: 'the picture' });
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('src', new RegExp(`/monitor/api/projects/${alpha}/tasks/${id}/attachments/${attachment}$`));
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
});

test('an image in a history reason shows in the History tab from the monitor attachment route', async ({ page }) => {
  const json = (args: string[]) => JSON.parse(agboard('Alpha', [...args, '--json'], home).stdout);
  const id: number = json(['add', 'Alpha history evidence', '--desc', 'A task with evidence.', '--assignee', 'ai', '--actor', 'ai']).task.id;
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==',
    'base64',
  );
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'agboard-history-image-')), 'evidence.png');
  writeFileSync(file, png);
  const added = json(['attachment', 'add', String(id), '--file', file, '--actor', 'ai']);
  const reason = `Checked.\n\n| Screen | Result |\n| --- | --- |\n| Board | Passed |\n\n![the evidence](${added.path})`;
  const noted = agboard('Alpha', ['history', 'add', String(id), '--reason', reason], home);
  expect(noted.code, noted.stderr).toBe(0);

  await entrance.open(page, monitorUrl());
  await page.getByRole('button', { name: 'Alpha history evidence' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: /History/ }).click();
  await expect(dialog.getByRole('cell', { name: 'Passed' })).toBeVisible();
  const image = dialog.getByRole('img', { name: 'the evidence' });
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('src', new RegExp(`/monitor/api/projects/${alpha}/tasks/${id}/attachments/${added.attachment.id}$`));
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
});

test('nothing is read or answered without a session, and a replaced tunnel needs a new passcode', async ({ page }) => {
  const bare = await playwrightRequest.newContext();
  const base = `${entrance.phoneOrigin}/monitor/api`;
  for (const path of [`/projects/${alpha}/summary`, `/projects/${alpha}/tasks/1/detail`, `/events?project=${alpha}`, '/session']) {
    const response = await bare.get(`${base}${path}`);
    expect(response.status(), path).toBe(401);
    expect((await response.json()).error?.code ?? (await response.json()).code).toBe('session_required');
    expect(response.headers()['set-cookie']).toBeUndefined();
  }
  const forged = await bare.post(`${base}/projects/${alpha}/tasks/2/answer`, {
    headers: { Cookie: 'agboard_ngrok_session=' + '0'.repeat(64), 'X-Agboard-Csrf': '0'.repeat(64) },
    data: { requestId: 'x', text: 'forged' },
  });
  expect(forged.status()).toBe(401);
  await bare.dispose();

  // A real session reads; after the tunnel is replaced the same cookie reads nothing.
  await entrance.open(page, monitorUrl());
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

  // The page does not open a session by itself: it asks for the passcode of the new run.
  await page.goto(monitorUrl());
  await expect(page.getByRole('heading', { name: 'Enter the passcode' })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
  await entrance.unlockPage(page);
  await expect(page.getByRole('article', { name: /Alpha running one/ })).toBeVisible();

  // Stopped, the phone can read nothing.
  await entrance.stopTunnel();
  const closed = await page.goto(monitorUrl());
  expect(closed?.status()).toBeGreaterThanOrEqual(500);
  await expect(page.getByRole('article')).toHaveCount(0);
});

test('five wrong passcodes close the run, even to the right one, until the connection starts again', async ({ page }) => {
  // The tunnel was stopped by the last test; a restart is a new run with a new passcode.
  await entrance.restart();
  await page.goto(monitorUrl());
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
