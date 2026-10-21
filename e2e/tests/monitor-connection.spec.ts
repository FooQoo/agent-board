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
// stand-in that adds the public Host and the proof. Google sign-in, the allow list, the proof
// being added and header removal belong to a real Edge and are NOT exercised here; they stay
// with the real-device and Edge check. No connection to ngrok is made.
test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 375, height: 812 }, locale: 'en-US', timezoneId: 'UTC' });

let home: string;
let alpha: string;
let entrance: PhoneEntrance;

const monitorUrl = () => `${entrance.phoneOrigin}/monitor/?project=${alpha}`;

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

test('the phone lists the board through the entrance and exposes nothing of the PC board', async ({ page }) => {
  await page.goto(monitorUrl());
  await expect(page.getByRole('status')).toContainText('Connected');
  await expect(page.getByRole('article', { name: /Alpha pending review/ })).toBeVisible();
  await expect(page.getByRole('article', { name: /Alpha running one/ })).toBeVisible();
  await expect(page.getByRole('article', { name: /Alpha ordinary todo/ })).toBeVisible();
  await expect(page.getByRole('article', { name: /Beta pending review/ })).toHaveCount(0);
  // The header logo comes through the entrance too.
  await expect.poll(() => page.locator('.header__logo img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

  // The PC board, its API and the desktop write routes are not behind the entrance.
  const direct = await playwrightRequest.newContext();
  for (const path of ['/', '/api/projects', `/api/projects/${alpha}/tasks/1/move`]) {
    const response = await direct.fetch(`${entrance.phoneOrigin}${path}`, { method: path.endsWith('/move') ? 'POST' : 'GET' });
    expect(response.status(), path).toBe(404);
  }
  await direct.dispose();
});

test('the phone answers the current question, and the answer reaches the shared files', async ({ page }) => {
  await page.goto(monitorUrl());
  const article = page.getByRole('article', { name: /Alpha pending review/ });
  await expect(article.getByRole('region', { name: 'The agent is waiting for your answer' })).toBeVisible();
  await article.getByRole('textbox', { name: 'Your answer' }).fill('Reviewed on the phone.');
  const answered = page.waitForResponse((response) =>
    response.url().includes('/tasks/1/answer') && response.request().method() === 'POST');
  await article.getByRole('button', { name: 'Send', exact: true }).click();
  expect((await answered).status()).toBe(200);
  await expect(article.getByRole('region', { name: 'The agent is waiting for your answer' })).toHaveCount(0);

  const task = JSON.parse(agboard('Alpha', ['show', '1', '--json'], home).stdout).task as {
    agentStatus: string;
    pendingRequestId: string | null;
    history: { reason: string }[];
  };
  expect(task.pendingRequestId).toBeNull();
  expect(task.agentStatus).toBe('idle');
  expect(task.history.at(-1)?.reason).toContain('Reviewed on the phone.');
});

test('nothing is read or answered without a session, and a replaced tunnel ends the old one', async ({ page }) => {
  const bare = await playwrightRequest.newContext();
  const base = `${entrance.phoneOrigin}/monitor/api`;
  for (const path of ['/projects', `/projects/${alpha}/board`, '/events']) {
    const response = await bare.get(`${base}${path}`);
    expect(response.status(), path).toBe(401);
    expect((await response.json()).error?.code ?? (await response.json()).code).toBe('session_required');
  }
  const forged = await bare.post(`${base}/projects/${alpha}/tasks/2/answer`, {
    headers: { Cookie: 'agboard_ngrok_session=' + '0'.repeat(64), 'X-Agboard-Csrf': '0'.repeat(64) },
    data: { requestId: 'x', text: 'forged' },
  });
  expect(forged.status()).toBe(401);
  await bare.dispose();

  // A real session reads; after the tunnel is replaced the same cookie reads nothing.
  await page.goto(monitorUrl());
  await expect(page.getByRole('article', { name: /Alpha running one/ })).toBeVisible();
  const cookies = await page.context().cookies();
  const session = cookies.find((cookie) => cookie.name === 'agboard_ngrok_session');
  expect(session).toBeDefined();
  const old = await playwrightRequest.newContext({
    extraHTTPHeaders: { Cookie: `agboard_ngrok_session=${session!.value}` },
  });
  expect((await old.get(`${base}/projects`)).status()).toBe(200);
  await entrance.rotate();
  expect((await old.get(`${base}/projects`)).status()).toBe(401);
  await old.dispose();

  // The page opens a new session for the new tunnel by itself.
  await page.goto(monitorUrl());
  await expect(page.getByRole('article', { name: /Alpha running one/ })).toBeVisible();

  // Stopped, the phone can read nothing.
  await entrance.stopTunnel();
  const closed = await page.goto(monitorUrl());
  expect(closed?.status()).toBeGreaterThanOrEqual(500);
  await expect(page.getByRole('article')).toHaveCount(0);
});
