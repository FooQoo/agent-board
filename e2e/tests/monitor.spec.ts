import { expect, test, type Page } from '@playwright/test';
import { removeProject } from '../helpers/agboard';
import {
  createMonitorHome,
  addDenseMonitorFixture,
  monitorOrigin,
  monitorProjectId,
  removeMonitorHome,
  startMonitorServe,
  stopMonitorServe,
  type MonitorServe,
} from '../helpers/monitor';

test.describe.configure({ mode: 'serial' });
test.use({ baseURL: `${monitorOrigin}/` });

let home: string;
let serve: MonitorServe | undefined;
let alpha: string;
let beta: string;

test.beforeAll(async () => {
  home = createMonitorHome();
  alpha = monitorProjectId(home, 'Alpha');
  beta = monitorProjectId(home, 'Beta');
  serve = await startMonitorServe(home);
});

test.afterAll(async () => {
  await stopMonitorServe(serve);
  if (home) removeMonitorHome(home);
});

test('loading is distinct from an empty project', async ({ page }) => {
  let catalogReads = 0;
  await page.route('**/monitor/api/projects', async (route) => {
    catalogReads++;
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await page.setViewportSize({ width: 375, height: 640 });
  await page.goto('/monitor/');
  await expect(page.getByRole('region', { name: 'Cards' })).toContainText('Loading monitor…');
  await expect(page.getByRole('status')).toContainText('Loading monitor…');
  await expect(page.getByText('No pending decisions.')).toHaveCount(0);
  await expect(page.getByRole('article', { name: /Alpha pending review/ })).toBeVisible();
  expect(catalogReads).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'All Projects' }).click();
  await page.getByRole('menuitemradio', { name: 'Empty', exact: true }).click();
  const summary = page.getByRole('region', { name: 'Work summary' });
  for (const tile of ['Running', 'Pending', 'Done']) {
    await expect(summary.getByRole('button', { name: `0 ${tile}` })).toBeVisible();
  }
  for (const section of ['Awaiting your decision', 'Running work', 'Todo', 'Doing', 'Done']) {
    await expect(page.getByRole('heading', { name: new RegExp(`^${section}\\s+0$`) })).toHaveCount(1);
  }
});

test('monitor reads the shared language and theme settings', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 640 });
  await page.goto('/monitor/');
  await expect(page.getByRole('status')).toContainText('Connected · Current');
  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('radio', { name: '日本語' }).click();
  const japaneseSettings = page.getByRole('dialog', { name: '設定' });
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await japaneseSettings.getByRole('radio', { name: 'ダーク・レッド' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'red');
  await expect(page.getByRole('button', { name: '更新' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('接続中 · 最新');

  const japaneseTiles = [
    { count: 3, label: '稼働中' },
    { count: 2, label: '待機中' },
    { count: 9, label: '完了' },
  ];
  const japaneseSummary = page.getByRole('region', { name: '作業の概要' });
  for (const tile of japaneseTiles) {
    await expect(japaneseSummary.getByRole('button', { name: `${tile.count} ${tile.label}` })).toBeVisible();
  }
  for (const section of [
    { count: 2, label: '判断待ち' },
    { count: 3, label: 'Running の作業' },
  ]) {
    await expect(page.getByRole('heading', { name: new RegExp(`^${section.label}\\s+${section.count}$`) })).toHaveCount(1);
  }
  const japanesePending = page.getByRole('article', { name: /Alpha pending review/ });
  const japaneseRunning = page.getByRole('article', { name: /Alpha running one/ });
  const japaneseIdle = page.getByRole('article', { name: /Alpha idle doing/ });
  await expect(japanesePending).toHaveAccessibleName(/判断待ち/);
  await expect(japanesePending).toHaveAccessibleName(/待機中/);
  await expect(japaneseRunning).toHaveAccessibleName(/Running の作業/);
  await expect(japaneseRunning).toHaveAccessibleName(/稼働中/);
  await expect(japaneseIdle).toHaveAccessibleName(/進行中/);
  await expect(japaneseIdle).toHaveAccessibleName(/未稼働/);
  await expect(japanesePending.locator('.status-label')).toHaveText('待機中');
  await expect(japaneseRunning.locator('.status-label')).toHaveText('稼働中');
  await expect(japaneseIdle.locator('.status-label')).toHaveText('未稼働');
  await expect(page.getByRole('article', { name: /Alpha draft card/ })).toHaveAccessibleName(/未着手/);
  await expect(page.getByRole('article', { name: /Alpha ordinary todo/ })).toHaveAccessibleName(/未着手/);
  await expect(page.getByRole('article', { name: /Alpha completed 1/ })).toHaveAccessibleName(/完了/);
  await expect(page.getByRole('article', { name: /Alpha draft card/ }).locator('.status-label')).toHaveCount(0);
  await expect(page.getByRole('article', { name: /Alpha ordinary todo/ }).locator('.status-label')).toHaveCount(0);
  await expect(page.getByRole('article', { name: /Alpha completed 1/ }).locator('.status-label')).toHaveCount(0);
  await page.getByRole('button', { name: '設定' }).click();
  await page.getByRole('dialog', { name: '設定' }).getByRole('radio', { name: 'English' }).click();
  await page.keyboard.press('Escape');
  const englishSummary = page.getByRole('region', { name: 'Work summary' });
  for (const [count, label] of [[3, 'Running'], [2, 'Pending'], [9, 'Done']] as const) {
    await expect(englishSummary.getByRole('button', { name: `${count} ${label}` })).toBeVisible();
  }
  for (const [count, label] of [[3, 'Running work'], [2, 'Awaiting your decision'], [2, 'Todo'], [1, 'Doing'], [9, 'Done']] as const) {
    await expect(page.getByRole('heading', { name: new RegExp(`^${label}\\s+${count}$`) })).toHaveCount(1);
  }
  const englishPending = page.getByRole('article', { name: /Alpha pending review/ });
  const englishRunning = page.getByRole('article', { name: /Alpha running one/ });
  const englishIdle = page.getByRole('article', { name: /Alpha idle doing/ });
  await expect(englishPending).toHaveAccessibleName(/Awaiting your decision/);
  await expect(englishPending).toHaveAccessibleName(/Pending/);
  await expect(englishRunning).toHaveAccessibleName(/Running work/);
  await expect(englishRunning).toHaveAccessibleName(/Running/);
  await expect(englishIdle).toHaveAccessibleName(/Doing/);
  await expect(englishIdle).toHaveAccessibleName(/Idle/);
  await expect(englishPending.locator('.status-label')).toHaveText('Pending');
  await expect(englishRunning.locator('.status-label')).toHaveText('Running');
  await expect(englishIdle.locator('.status-label')).toHaveText('Idle');
  await expect(page.getByRole('article', { name: /Alpha draft card/ })).toHaveAccessibleName(/Todo/);
  await expect(page.getByRole('article', { name: /Alpha ordinary todo/ })).toHaveAccessibleName(/Todo/);
  await expect(page.getByRole('article', { name: /Alpha completed 1/ })).toHaveAccessibleName(/Done/);
  await expect(page.getByRole('article', { name: /Alpha draft card/ }).locator('.status-label')).toHaveCount(0);
  await expect(page.getByRole('article', { name: /Alpha ordinary todo/ }).locator('.status-label')).toHaveCount(0);
  await expect(page.getByRole('article', { name: /Alpha completed 1/ }).locator('.status-label')).toHaveCount(0);
});

test('a lost event stream keeps the latest snapshot, manual refresh works, and visibility reconnects', async ({ page }) => {
  await page.addInitScript(() => {
    let current: DocumentVisibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => current });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => current === 'hidden' });
    Object.defineProperty(window, 'setMonitorVisibility', {
      configurable: true,
      value: (next: DocumentVisibilityState) => {
        current = next;
        document.dispatchEvent(new Event('visibilitychange'));
      },
    });
  });
  let catalogReads = 0;
  await page.route('**/monitor/api/projects', async (route) => {
    catalogReads++;
    await route.continue();
  });
  await page.route('**/monitor/api/events', (route) => route.abort());
  await page.setViewportSize({ width: 375, height: 640 });
  await page.goto('/monitor/');
  await expect(page.getByRole('article', { name: /Alpha pending review/ })).toBeVisible();
  await expect(page.getByText('Updated · Automatic updates stopped')).toBeVisible();
  const readsBeforeManualRefresh = catalogReads;
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(() => catalogReads).toBeGreaterThan(readsBeforeManualRefresh);
  await expect(page.getByRole('article', { name: /Alpha pending review/ })).toBeVisible();

  await page.evaluate(() => (window as unknown as { setMonitorVisibility: (next: DocumentVisibilityState) => void }).setMonitorVisibility('hidden'));
  await expect(page.getByText('Updated · Automatic updates stopped')).toBeVisible();
  await page.unroute('**/monitor/api/events');
  await page.evaluate(() => (window as unknown as { setMonitorVisibility: (next: DocumentVisibilityState) => void }).setMonitorVisibility('visible'));
  await expect(page.getByText('Connected · Current')).toBeVisible();
});

test('a missing event-stream heartbeat marks the snapshot stale and retries the stream', async ({ page }) => {
  await page.clock.install();
  let catalogResponses = 0;
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === '/monitor/api/projects') catalogResponses++;
  });
  await page.addInitScript(() => {
    type FakeSource = { emit(type: string): void; close(): void; closed: boolean };
    const host = window as unknown as { __monitorEventSources: FakeSource[]; EventSource: typeof EventSource };
    host.__monitorEventSources = [];
    host.EventSource = class {
      constructor() {
        const listeners = new Map<string, Set<EventListener>>();
        const source: FakeSource = {
          closed: false,
          addEventListener(type: string, listener: EventListener) {
            const group = listeners.get(type) ?? new Set<EventListener>();
            group.add(listener);
            listeners.set(type, group);
          },
          emit(type: string) {
            for (const listener of listeners.get(type) ?? []) listener(new Event(type));
          },
          close() {
            source.closed = true;
          },
        } as FakeSource;
        host.__monitorEventSources.push(source);
        return source;
      }
    } as unknown as typeof EventSource;
  });
  await page.setViewportSize({ width: 375, height: 640 });
  await page.goto('/monitor/');
  await expect(page.getByRole('article', { name: /Alpha pending review/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __monitorEventSources: unknown[] }).__monitorEventSources.length)).toBe(1);
  await page.evaluate(() => (window as unknown as { __monitorEventSources: Array<{ emit(type: string): void }> }).__monitorEventSources[0]?.emit('ready'));
  await expect.poll(() => catalogResponses).toBe(4);
  await expect(page.getByRole('status')).toContainText('Connected · Current');

  const lastFetched = await page.locator('.monitor-freshness__time').innerText();
  // A disconnect triggers a snapshot read; fail it to check that the last successful time survives.
  await page.route('**/monitor/api/projects', (route) => route.abort());

  await page.clock.fastForward(45_000);
  await expect(page.getByRole('status')).toContainText('Updated · Automatic updates stopped');
  await expect(page.locator('.monitor-freshness__time')).toHaveText(lastFetched);
  expect(await page.evaluate(() => (window as unknown as { __monitorEventSources: Array<{ closed: boolean }> }).__monitorEventSources[0]?.closed)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __monitorEventSources: unknown[] }).__monitorEventSources.length)).toBe(1);

  await page.clock.fastForward(1_000);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __monitorEventSources: unknown[] }).__monitorEventSources.length)).toBe(2);
});

test('a timed-out catalog read keeps the last snapshot instead of showing zero work', async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 375, height: 640 });
  await page.goto('/monitor/');
  await expect(page.getByRole('article', { name: /Alpha pending review/ })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Connected · Current');

  let markRequestStarted!: () => void;
  const requestStarted = new Promise<void>((resolve) => { markRequestStarted = resolve; });
  let releaseRequest: (() => void) | undefined;
  await page.route('**/monitor/api/projects', (route) => {
    markRequestStarted();
    return new Promise<void>((resolve) => {
      releaseRequest = () => { void route.abort().catch(() => undefined).finally(resolve); };
    });
  });
  await page.getByRole('button', { name: 'Refresh' }).click();
  await requestStarted;
  await page.clock.fastForward(10_000);
  await expect(page.getByRole('status')).toContainText('Updated · Automatic updates stopped');
  await expect(monitorCard(page, 1, 'Alpha pending review')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Work summary' }).getByRole('button', { name: '3 Running' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Work summary' }).getByRole('button', { name: '2 Pending' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Work summary' }).getByRole('button', { name: '9 Done' })).toBeVisible();
  releaseRequest?.();
  await page.unroute('**/monitor/api/projects');
});

const monitorCard = (page: Page, id: number, title: string) =>
  page.getByRole('article', { name: new RegExp(`^#${id}.*${title}`) });

test('the shared entry chooses once at the initial width, preserving query and fragment', async ({ page }) => {
  for (const width of [375, 767]) {
    await page.setViewportSize({ width, height: 640 });
    await page.goto(`/?project=${alpha}&x=1#running`);
    await expect(page).toHaveURL(`${monitorOrigin}/monitor/?project=${alpha}&x=1#running`);
    await expect(page.getByRole('region', { name: 'Cards' })).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page).toHaveURL(`${monitorOrigin}/monitor/?project=${alpha}&x=1#running`);
  }
  for (const width of [768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/?project=${alpha}&x=1#running`);
    await expect(page).toHaveURL(`${monitorOrigin}/board/?project=${alpha}&x=1#running`);
    await expect(page.getByRole('button', { name: 'Add card' })).toBeVisible();
  }

  await page.setViewportSize({ width: 375, height: 640 });
  await page.route('**/assets/access/entry.js*', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Open read-only monitor' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open board' })).toBeVisible();
});

test('monitor renders both projects and same-number cards, preserves direct routes, and keeps all content inside its panels', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 640 });
  const requests: string[] = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  await page.goto('/monitor/');
  await expect(page.getByRole('button', { name: 'All Projects' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Cards' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Work summary' }).getByRole('button', { name: '3 Running' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Work summary' }).getByRole('button', { name: '2 Pending' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Work summary' }).getByRole('button', { name: '9 Done' })).toBeVisible();
  await expect(monitorCard(page, 1, 'Alpha pending review')).toBeVisible();
  await expect(monitorCard(page, 1, 'Beta pending review')).toBeVisible();
  await expect(monitorCard(page, 2, 'Alpha running one')).toBeVisible();
  await expect(monitorCard(page, 3, 'Alpha running two')).toBeVisible();
  await expect(monitorCard(page, 11, 'Alpha completed 8')).toHaveCount(1);
  expect(requests).toContain('/assets/monitor/monitor.js');
  expect(requests).not.toContain('/assets/app.js');
  expect(requests).not.toContain('/assets/index.js');

  const html = await page.request.get('/monitor/');
  const htmlText = await html.text();
  expect(html.status()).toBe(200);
  expect(htmlText).not.toMatch(/agboard-token|\/assets\/app\.js|\/assets\/index\.js/);
  const csp = html.headers()['content-security-policy'];
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("connect-src 'self'");
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await page.request.fetch(`/monitor/api/projects/${alpha}/board`, { method });
    expect(response.status(), `${method} must be rejected`).toBe(405);
  }

  const originalUrl = page.url();
  await page.getByRole('article', { name: /^#4(?!\d)/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Card details' })).toHaveCount(0);
  await expect(page).toHaveURL(originalUrl);
  await expect(page.locator('.monitor-card button, .monitor-card a, .monitor-card[tabindex]')).toHaveCount(0);
  await page.goto(`/monitor/?project=${alpha}&cardProject=${alpha}&card=4&tab=history`);
  await expect(page).toHaveURL(`${monitorOrigin}/monitor/?project=${alpha}`);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.setViewportSize({ width: 320, height: 568 });
  await page.reload();
  await expect(page.getByRole('region', { name: 'Cards' })).toBeVisible();
  const overflow = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    height: document.documentElement.clientHeight,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.width);
  expect(overflow.scrollHeight).toBeLessThanOrEqual(overflow.height);
});

test('direct monitor and board URLs stay on their chosen view across reload and rotation', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 640 });
  await page.goto(`/monitor/?project=${alpha}`);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Cards' })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole('region', { name: 'Cards' })).toBeVisible();
  await page.goto(`/board/?project=${alpha}`);
  await page.setViewportSize({ width: 375, height: 640 });
  await expect(page.getByRole('button', { name: 'Add card' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Add card' })).toBeVisible();
});

test('100 cards and 100-character titles remain reachable without opening details on a narrow screen', async ({ page }) => {
  test.setTimeout(120_000);
  await stopMonitorServe(serve);
  const longProject = addDenseMonitorFixture(home);
  serve = await startMonitorServe(home);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/monitor/');
  await expect(page.getByRole('region', { name: 'Cards' })).toBeVisible();
  await page.getByRole('button', { name: 'All Projects' }).click();
  await page.getByRole('menuitemradio', { name: 'Alpha', exact: true }).click();
  await page.getByRole('region', { name: 'Work summary' }).getByRole('button', { name: '94 Done' }).click();
  const list = page.getByRole('region', { name: 'Cards' });
  await expect(list.getByRole('article', { name: /#100.*Done/ })).toBeVisible();
  expect(await list.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await list.getByRole('article', { name: /#100.*Done/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: 'Alpha', exact: true }).click();
  await page.getByRole('menuitemradio', { name: longProject, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`project=${monitorProjectId(home, longProject)}`));
  await expect(page.getByRole('article', { name: /T{100}/ })).toBeVisible();
  const width = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.client);
});

test('deleting the selected project clears the stale scope and removes it from the menu', async ({ page }) => {
  const deleteMe = monitorProjectId(home, 'DeleteMe');
  await page.setViewportSize({ width: 375, height: 640 });
  await page.goto(`/monitor/?project=${deleteMe}`);
  await expect(page.getByRole('button', { name: 'DeleteMe', exact: true })).toBeVisible();
  removeProject('DeleteMe', home);
  await expect(page.getByRole('button', { name: 'All Projects' })).toBeVisible();
  await expect(page).not.toHaveURL(new RegExp(`project=${deleteMe}`));
  await page.getByRole('button', { name: 'All Projects' }).click();
  await expect(page.getByRole('menuitemradio', { name: 'DeleteMe', exact: true })).toHaveCount(0);
});
