import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const storybookOrigin = process.env.AGBOARD_STORYBOOK_E2E_PORT
  ? `http://127.0.0.1:${process.env.AGBOARD_STORYBOOK_E2E_PORT}`
  : 'http://127.0.0.1:8670';

function storyUrl(id: string, globals: string) {
  return `/iframe.html?id=${id}&viewMode=story&globals=${encodeURIComponent(globals)}`;
}

async function openStory(page: Page, id: string, globals = 'locale:en;mode:light;accent:blue;width:desktop') {
  await page.goto(storyUrl(id, globals));
  const settings = Object.fromEntries(globals.split(';').map((entry) => entry.split(':')));
  const frame = page.locator('.story-frame');
  await expect(frame).toBeAttached();
  await expect(frame).toHaveAttribute('data-story-width', settings.width ?? 'desktop');
  await expect(page.locator('html')).toHaveAttribute('lang', settings.locale ?? 'en');
  await expect(page.locator('html')).toHaveAttribute('data-mode', settings.mode ?? 'light');
  await expect(page.locator('html')).toHaveAttribute('data-accent', settings.accent ?? 'blue');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images, (image) =>
        image.decode().catch(() => undefined),
      ),
    );
  });
}

function watchForRuntimeProblems(page: Page, allowedFixturePaths: string[] = []) {
  const errors: string[] = [];
  const productRequests: string[] = [];

  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    const isProductApi =
      url.pathname === '/api' ||
      url.pathname.startsWith('/api/') ||
      url.pathname === '/monitor/api' ||
      url.pathname.startsWith('/monitor/api/');
    if (isProductApi && !allowedFixturePaths.includes(url.pathname)) {
      productRequests.push(`${request.method()} ${url.pathname}`);
    }
  });

  return { errors, productRequests };
}

test('renders the real workspace with localized theme settings', async ({ page }) => {
  const problems = watchForRuntimeProblems(page);
  await openStory(
    page,
    'app-board-workspace--board',
    'locale:ja;mode:light;accent:blue;width:desktop',
  );

  const frame = page.locator('.story-frame');
  await expect(frame).toHaveAttribute('data-story-width', 'desktop');
  await expect(frame).toHaveAttribute('data-story-frame', 'board');
  await expect(frame).toHaveCSS('width', '1280px');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'blue');
  await expect(page.getByRole('heading', { name: 'Initialize the board' })).toBeVisible();
  expect(problems.errors).toEqual([]);
  expect(problems.productRequests).toEqual([]);
});

test('loads representative list, decision, mobile drawer and dialog stories', async ({ page }) => {
  const problems = watchForRuntimeProblems(page);
  await openStory(page, 'shared-ui-button--default');
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();

  await openStory(page, 'pages-board-board--three-lanes');
  await expect(page.getByRole('button', { name: /Draft the plan/ })).toBeVisible();

  await openStory(page, 'task-answer-decisionrequestformview--failed-with-input-kept');
  await expect(page.getByRole('alert')).toContainText('Could not save. Try again.');
  await expect(page.getByRole('textbox', { name: 'Your answer' })).toHaveValue(
    'Please keep this note.',
  );

  await openStory(page, 'pages-monitor-components-monitordetaildrawer--four-tabs');
  await expect(page.getByRole('dialog', { name: 'Mobile drawer example' })).toBeVisible();

  expect(problems.errors).toEqual([]);
  expect(problems.productRequests).toEqual([]);
});

test('runs the dialog failure-and-retry Story and preserves its saved input', async ({ page }) => {
  const fixturePath =
    '/api/projects/sample-project/epics/planning/attachments/0123456789abcdef0123456789abcdef';
  const problems = watchForRuntimeProblems(page, [fixturePath]);
  let fixtureImageRequests = 0;
  await page.route(`**${fixturePath}`, async (route) => {
    fixtureImageRequests += 1;
    await route.fulfill({
      contentType: 'image/png',
      body: await readFile(new URL('../../web/.storybook/static/sample-attachment.png', import.meta.url)),
    });
  });
  await openStory(page, 'epic-editor-epicdialog--details-save-retry');

  const name = page.getByLabel('Formal name');
  await expect(name).toHaveValue('Updated plan');
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(fixtureImageRequests).toBe(1);

  expect(problems.errors).toEqual([]);
  expect(problems.productRequests).toEqual([]);
});

test('renders the four-tab drawer at a narrow monitor width', async ({ page }) => {
  const problems = watchForRuntimeProblems(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openStory(
    page,
    'pages-monitor-components-monitordetaildrawer--four-tabs',
    'locale:en;mode:light;accent:purple;width:phone-390',
  );

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('tab')).toHaveCount(4);
  await expect(page.locator('.story-frame')).toHaveCSS('width', '390px');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    .toBe(true);
  expect(problems.errors).toEqual([]);
  expect(problems.productRequests).toEqual([]);
});

test('serves the generated Storybook index and static assets from the isolated preview', async ({ request }) => {
  const indexResponse = await request.get(`${storybookOrigin}/index.json`);
  expect(indexResponse.ok()).toBe(true);
  const index = (await indexResponse.json()) as {
    entries: Record<string, { type: string }>;
  };
  for (const id of [
    'app-board-workspace--board',
    'task-answer-decisionrequestformview--failed-with-input-kept',
    'epic-editor-epicdialog--details-save-retry',
  ]) {
    expect(index.entries[id]?.type).toBe('story');
  }

  const assetResponse = await request.get(`${storybookOrigin}/logo.svg`);
  expect(assetResponse.ok()).toBe(true);
});
