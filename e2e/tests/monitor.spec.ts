import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  await expect(page.getByRole('region', { name: 'Tasks' })).toContainText('Loading monitor…');
  await expect(page.getByRole('status')).toContainText('Loading monitor…');
  await expect(page.getByText('No pending decisions.')).toHaveCount(0);
  await expect(page.getByRole('article', { name: /Alpha pending review/ })).toBeVisible();
  expect(catalogReads).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'All Projects' }).click();
  await page.getByRole('menuitemradio', { name: 'Empty', exact: true }).click();
  const summary = page.getByRole('region', { name: 'Work summary' });
  for (const tile of ['Todo', 'Doing', 'Done']) {
    await expect(summary.getByRole('button', { name: `0 ${tile}` })).toBeVisible();
  }
  for (const section of ['Todo', 'Doing', 'Done']) {
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
    { count: 2, label: '未着手' },
    { count: 6, label: '進行中' },
    { count: 9, label: '完了' },
  ];
  const japaneseSummary = page.getByRole('region', { name: '作業の概要' });
  for (const tile of japaneseTiles) {
    await expect(japaneseSummary.getByRole('button', { name: `${tile.count} ${tile.label}` })).toBeVisible();
  }
  for (const section of [
    { count: 2, label: '未着手' },
    { count: 6, label: '進行中' },
    { count: 9, label: '完了' },
  ]) {
    await expect(page.getByRole('heading', { name: new RegExp(`^${section.label}\\s+${section.count}$`) })).toHaveCount(1);
  }
  const japanesePending = page.getByRole('article', { name: /Alpha pending review/ });
  const japaneseRunning = page.getByRole('article', { name: /Alpha running one/ });
  const japaneseIdle = page.getByRole('article', { name: /Alpha idle doing/ });
  await expect(japanesePending).toHaveAccessibleName(/進行中/);
  await expect(japanesePending).toHaveAccessibleName(/待機中/);
  await expect(japaneseRunning).toHaveAccessibleName(/進行中/);
  await expect(japaneseRunning).toHaveAccessibleName(/稼働中/);
  await expect(japaneseIdle).toHaveAccessibleName(/進行中/);
  await expect(japaneseIdle).toHaveAccessibleName(/未稼働/);
  await expect(japanesePending.locator('.status-label')).toHaveText('待機中');
  await expect(japaneseRunning.locator('.status-label')).toHaveText('稼働中');
  await expect(japaneseIdle.locator('.status-label')).toHaveText('未稼働');
  await expect(page.getByRole('article', { name: /Alpha draft task/ })).toHaveAccessibleName(/未着手/);
  await expect(page.getByRole('article', { name: /Alpha ordinary todo/ })).toHaveAccessibleName(/未着手/);
  await expect(page.getByRole('article', { name: /Alpha completed 1/ })).toHaveAccessibleName(/完了/);
  await expect(page.getByRole('article', { name: /Alpha draft task/ }).locator('.status-label')).toHaveText('未稼働');
  await expect(page.getByRole('article', { name: /Alpha ordinary todo/ }).locator('.status-label')).toHaveText('未稼働');
  await expect(page.getByRole('article', { name: /Alpha completed 1/ }).locator('.status-label')).toHaveCount(0);
  await page.getByRole('button', { name: '設定' }).click();
  await page.getByRole('dialog', { name: '設定' }).getByRole('radio', { name: 'English' }).click();
  await page.keyboard.press('Escape');
  const englishSummary = page.getByRole('region', { name: 'Work summary' });
  for (const [count, label] of [[2, 'Todo'], [6, 'Doing'], [9, 'Done']] as const) {
    await expect(englishSummary.getByRole('button', { name: `${count} ${label}` })).toBeVisible();
  }
  for (const [count, label] of [[2, 'Todo'], [6, 'Doing'], [9, 'Done']] as const) {
    await expect(page.getByRole('heading', { name: new RegExp(`^${label}\\s+${count}$`) })).toHaveCount(1);
  }
  const englishPending = page.getByRole('article', { name: /Alpha pending review/ });
  const englishRunning = page.getByRole('article', { name: /Alpha running one/ });
  const englishIdle = page.getByRole('article', { name: /Alpha idle doing/ });
  await expect(englishPending).toHaveAccessibleName(/Doing/);
  await expect(englishPending).toHaveAccessibleName(/Pending/);
  await expect(englishRunning).toHaveAccessibleName(/Doing/);
  await expect(englishRunning).toHaveAccessibleName(/Running/);
  await expect(englishIdle).toHaveAccessibleName(/Doing/);
  await expect(englishIdle).toHaveAccessibleName(/Idle/);
  await expect(englishPending.locator('.status-label')).toHaveText('Pending');
  await expect(englishRunning.locator('.status-label')).toHaveText('Running');
  await expect(englishIdle.locator('.status-label')).toHaveText('Idle');
  await expect(page.getByRole('article', { name: /Alpha draft task/ })).toHaveAccessibleName(/Todo/);
  await expect(page.getByRole('article', { name: /Alpha ordinary todo/ })).toHaveAccessibleName(/Todo/);
  await expect(page.getByRole('article', { name: /Alpha completed 1/ })).toHaveAccessibleName(/Done/);
  await expect(page.getByRole('article', { name: /Alpha draft task/ }).locator('.status-label')).toHaveText('Idle');
  await expect(page.getByRole('article', { name: /Alpha ordinary todo/ }).locator('.status-label')).toHaveText('Idle');
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
  await expect(monitorTask(page, 1, 'Alpha pending review')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Work summary' }).getByRole('button', { name: '2 Todo' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Work summary' }).getByRole('button', { name: '6 Doing' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Work summary' }).getByRole('button', { name: '9 Done' })).toBeVisible();
  releaseRequest?.();
  await page.unroute('**/monitor/api/projects');
});

const monitorTask = (page: Page, id: number, title: string) =>
  page.getByRole('article', { name: new RegExp(`^#${id}.*${title}`) });

test('the bottom drawer follows a downward handle drag and dismisses', async ({ page }) => {
  const browser = page.context().browser();
  if (!browser) throw new Error('The test browser was not available');
  const context = await browser.newContext({
    baseURL: `${monitorOrigin}/`,
    viewport: { width: 375, height: 640 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  try {
    const touchPage = await context.newPage();
    await touchPage.route('**/monitor/api/projects/*/board', async (route) => {
      const response = await route.fetch();
      const board = await response.json();
      for (const task of board.tasks) {
        if (task.title === 'Alpha completed 8') {
          task.epic = { id: 'SWIPE', name: 'Loaded swipe epic', color: '#4466aa' };
        }
      }
      await route.fulfill({ response, json: board });
    });
    let epicReads = 0;
    await touchPage.route('**/monitor/api/projects/*/epics', async (route) => {
      epicReads++;
      await route.fulfill({ json: { epics: [{
        id: 'SWIPE', name: 'Loaded swipe epic', color: '#4466aa', isDraft: false,
        body: 'Fresh epic content', document: 'Fresh epic content', acceptance: [],
        acceptanceError: false, attachments: [],
        createdAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:00Z',
      }] } });
    });
    await touchPage.goto('/monitor/');
    await touchPage.getByRole('button', { name: 'Alpha completed 8' }).waitFor();
    await expect.poll(() => epicReads).toBe(4);
    const boardText = await touchPage.locator('.monitor-list').textContent();
    await touchPage.getByRole('button', { name: 'Alpha completed 8' }).click();
    const drawer = touchPage.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute('data-swipe-direction', 'down');
    await expect(drawer).toHaveCSS('transition-property', 'translate');
    expect(await drawer.evaluate((element) => element.getAnimations().length)).toBeGreaterThan(0);
    await drawer.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });

    const cdp = await context.newCDPSession(touchPage);
    const panelBox = await drawer.locator('.monitor-drawer__panels').boundingBox();
    if (!panelBox) throw new Error('Missing swipe viewport');
    const y = panelBox.y + 100;
    for (const [fromX, toX, selected] of [
      [310, 70, 'Conditions'], [310, 70, 'History'], [310, 70, 'Epic'],
      [70, 310, 'History'], [70, 310, 'Conditions'], [70, 310, 'Body'],
    ] as const) {
      const previousProgress = await drawer.locator('.monitor-drawer__tabs').evaluate(
        (element) => Number((element as HTMLElement).style.getPropertyValue('--tab-progress')),
      );
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart', touchPoints: [{ x: fromX, y, id: 1 }],
      });
      for (let step = 1; step <= 12; step++) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: fromX + (toX - fromX) * step / 12, y: y + step / 2, id: 1 }],
        });
      }
      await expect.poll(() => drawer.locator('.monitor-drawer__tabs').evaluate(
        (element) => Number((element as HTMLElement).style.getPropertyValue('--tab-progress')),
      )).not.toBe(previousProgress);
      await expect(drawer).not.toHaveAttribute('data-swiping', '');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(drawer.getByRole('tab', { name: selected, exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect.poll(() => drawer.locator('.monitor-drawer__track').evaluate(
        (element) => element.getAnimations().length,
      )).toBe(0);
      await touchPage.waitForTimeout(600);
      if (selected === 'Epic') {
        await expect(drawer.getByText('Fresh epic content')).toBeVisible();
        expect(await touchPage.locator('.monitor-list').textContent()).toBe(boardText);
      }
    }

    expect(epicReads).toBe(4);
    const popupBox = await drawer.boundingBox();
    const handleBox = await drawer.locator('.mobile-drawer__handle').boundingBox();
    expect(popupBox).not.toBeNull();
    expect(handleBox).not.toBeNull();
    const startX = (handleBox?.x ?? 0) + (handleBox?.width ?? 0) / 2;
    const startY = (handleBox?.y ?? 0) + (handleBox?.height ?? 0) / 2;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: startX, y: startY, id: 1 }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: startX, y: startY + 40, id: 1 }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: startX, y: startY + 80, id: 1 }],
    });
    await expect(drawer).toHaveAttribute('data-swiping', '');
    const movedBox = await drawer.boundingBox();
    expect(movedBox?.y).toBeGreaterThan(popupBox?.y ?? 0);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: startX, y: startY + 180, id: 1 }],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(drawer).toHaveCount(0);
    await cdp.detach();
  } finally {
    await context.close();
  }
});

const drawerEvidence = (name: string) =>
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../evidence/uow6', name);

test('the shared entry chooses once at the initial width, preserving query and fragment', async ({ page }) => {
  for (const width of [375, 767]) {
    await page.setViewportSize({ width, height: 640 });
    await page.goto(`/?project=${alpha}&x=1#running`);
    await expect(page).toHaveURL(`${monitorOrigin}/monitor/?project=${alpha}&x=1#running`);
    await expect(page.getByRole('region', { name: 'Tasks' })).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page).toHaveURL(`${monitorOrigin}/monitor/?project=${alpha}&x=1#running`);
  }
  for (const width of [768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/?project=${alpha}&x=1#running`);
    await expect(page).toHaveURL(`${monitorOrigin}/board/?project=${alpha}&x=1#running`);
    await expect(page.getByRole('button', { name: 'Add task' })).toBeVisible();
  }

  await page.setViewportSize({ width: 375, height: 640 });
  await page.route('**/assets/access/entry.js*', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Open read-only monitor' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open board' })).toBeVisible();
});

test('monitor renders both projects and same-number tasks, preserves direct routes, and keeps all content inside its panels', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 640 });
  const requests: string[] = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  await page.goto('/monitor/');
  await expect(page.getByRole('button', { name: 'All Projects' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Tasks' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Work summary' }).getByRole('button', { name: '2 Todo' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Work summary' }).getByRole('button', { name: '6 Doing' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Work summary' }).getByRole('button', { name: '9 Done' })).toBeVisible();
  await expect(monitorTask(page, 1, 'Alpha pending review')).toBeVisible();
  await expect(monitorTask(page, 1, 'Beta pending review')).toBeVisible();
  await expect(monitorTask(page, 2, 'Alpha running one')).toBeVisible();
  await expect(monitorTask(page, 3, 'Alpha running two')).toBeVisible();
  await expect(monitorTask(page, 11, 'Alpha completed 8')).toHaveCount(1);
  expect(requests.some((url) => /^\/assets\/monitor\/monitor-[\w-]+\.js$/.test(url))).toBe(true);
  expect(requests.filter((url) => /^\/assets\/(app|index)[-.]/.test(url))).toEqual([]);

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
  await page.getByRole('button', { name: 'Alpha completed 8' }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('tab', { name: 'Body' })).toHaveAttribute('aria-selected', 'true');
  await expect(drawer.getByText('Completed detail 8.')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: drawerEvidence('drawer-375-en-light.png') });
  const panels = drawer.locator('.monitor-drawer__panels');
  const panelsBox = await panels.boundingBox();
  expect(panelsBox).not.toBeNull();
  const startX = (panelsBox?.x ?? 0) + (panelsBox?.width ?? 0) * 0.8;
  const endX = (panelsBox?.x ?? 0) + (panelsBox?.width ?? 0) * 0.2;
  const y = (panelsBox?.y ?? 0) + 80;
  const swipePanels = async (fromX: number, toX: number) => {
    const track = drawer.locator('.monitor-drawer__track');
    const before = await track.boundingBox();
    await page.mouse.move(fromX, y);
    await page.mouse.down();
    await page.mouse.move((fromX + toX) / 2, y, { steps: 8 });
    const during = await track.boundingBox();
    expect(Math.abs((during?.x ?? 0) - (before?.x ?? 0))).toBeGreaterThan(30);
    await page.mouse.move(toX, y, { steps: 8 });
    await page.mouse.up();
  };
  await swipePanels(startX, endX);
  await expect(drawer.getByRole('tab', { name: 'Conditions' })).toHaveAttribute('aria-selected', 'true');
  await swipePanels(endX, startX);
  await expect(drawer.getByRole('tab', { name: 'Body' })).toHaveAttribute('aria-selected', 'true');
  await drawer.getByRole('tab', { name: 'History' }).click();
  await expect(drawer.getByRole('tabpanel', { name: 'History' })).toBeVisible();
  await drawer.getByRole('button', { name: 'Close details', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(originalUrl);
  await expect(page.getByRole('button', { name: 'Alpha completed 8' })).toBeEnabled();

  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('radio', { name: '日本語' }).click();
  await page.getByRole('dialog', { name: '設定' }).getByRole('radio', { name: 'ダーク・レッド' }).click();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByRole('button', { name: 'Alpha completed 8' }).click();
  await expect(page.getByRole('dialog').getByRole('tab', { name: 'エピック' })).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: drawerEvidence('drawer-320-ja-dark.png') });
  const narrowDrawer = await page.getByRole('dialog').boundingBox();
  expect(narrowDrawer?.x).toBeGreaterThanOrEqual(0);
  expect((narrowDrawer?.x ?? 0) + (narrowDrawer?.width ?? 0)).toBeLessThanOrEqual(320);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: '設定' }).click();
  const japaneseSettings = page.getByRole('dialog', { name: '設定' });
  await japaneseSettings.getByRole('radio', { name: 'English' }).click();
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('radio', { name: 'Light Blue' }).click();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 430, height: 800 });
  await page.getByRole('button', { name: 'Alpha completed 8' }).click();
  await expect(page.getByRole('dialog').getByRole('tab', { name: 'Epic' })).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: drawerEvidence('drawer-430-en-light.png') });
  await expect(page.getByRole('dialog').getByRole('tab', { name: 'Body' })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('tab', { name: 'History' })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('tab', { name: 'Epic' })).toBeVisible();
  await page.goto(`/monitor/?project=${alpha}&taskProject=${alpha}&task=4&tab=history`);
  await expect(page).toHaveURL(`${monitorOrigin}/monitor/?project=${alpha}`);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.setViewportSize({ width: 320, height: 568 });
  await page.reload();
  await expect(page.getByRole('region', { name: 'Tasks' })).toBeVisible();
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
  await expect(page.getByRole('region', { name: 'Tasks' })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole('region', { name: 'Tasks' })).toBeVisible();
  await page.goto(`/board/?project=${alpha}`);
  await page.setViewportSize({ width: 375, height: 640 });
  await expect(page.getByRole('button', { name: 'Add task' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Add task' })).toBeVisible();
});

test('100 tasks and 100-character titles remain reachable and open details on a narrow screen', async ({ page }) => {
  test.setTimeout(120_000);
  await stopMonitorServe(serve);
  const longProject = addDenseMonitorFixture(home);
  serve = await startMonitorServe(home);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/monitor/');
  await expect(page.getByRole('region', { name: 'Tasks' })).toBeVisible();
  await page.getByRole('button', { name: 'All Projects' }).click();
  await page.getByRole('menuitemradio', { name: 'Alpha', exact: true }).click();
  await page.getByRole('region', { name: 'Work summary' }).getByRole('button', { name: '94 Done' }).click();
  const list = page.getByRole('region', { name: 'Tasks' });
  await expect(list.getByRole('article', { name: /#100.*Done/ })).toBeVisible();
  expect(await list.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await list.getByRole('article', { name: /#100.*Done/ }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('heading', { name: /^Task 100 L+/ })).toBeVisible();
  await drawer.getByRole('button', { name: 'Close details', exact: true }).click();
  await expect(drawer).toHaveCount(0);

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
