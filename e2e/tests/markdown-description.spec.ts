import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { agboardOk, mainProject, nextCardId, resetBoard } from '../helpers/agboard';
import { startImageServer, type ImageServer } from '../helpers/imageServer';
import { longMarkdown } from '../helpers/markdown';
import { waitForSync } from '../helpers/ui';

// A card whose description is long Markdown, made with the real CLI, read on the real page. External images
// and links come from a sample server on the loopback address (port 7890), never from the internet.

let images: ImageServer;
let work: string;

test.beforeAll(async () => {
  images = await startImageServer(7890);
  work = mkdtempSync(path.join(os.tmpdir(), 'agent-board-e2e-md-'));
});

test.afterAll(async () => {
  await images.close();
  rmSync(work, { recursive: true, force: true });
});

const details = (page: Page) => page.getByRole('complementary', { name: 'Card details' });
const card = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });
const body = (page: Page) => details(page).getByRole('tabpanel');
/** The fold button of an H2 section; its name carries the count. */
const fold = (page: Page, title: string) => body(page).getByRole('button', { name: new RegExp(`^${title} \\d+$`) });

async function addLongCard(title = 'Long markdown'): Promise<number> {
  const id = nextCardId(mainProject);
  const file = path.join(work, 'long.md');
  writeFileSync(file, longMarkdown(images.origin));
  agboardOk(mainProject, ['add', title, '--desc-file', file]);
  return id;
}

async function openCard(page: Page, id: number): Promise<void> {
  await page.goto('/');
  await waitForSync(page);
  await card(page, id).click();
  await expect(details(page).getByRole('heading', { level: 2 })).toBeVisible();
}

test.beforeEach(() => {
  resetBoard(mainProject);
  images.paths.length = 0;
  images.referers.length = 0;
});

test('a long Markdown card shows every section open, with counts, tables, checklists, quotes, and struck text', async ({
  page,
}) => {
  const id = await addLongCard();
  await openCard(page, id);
  const panel = body(page);

  // The text before the first H2 is always shown, and a single line break is a line break.
  const intro = panel.getByText('Intro line one before the first section.');
  expect(await intro.evaluate((element) => (element as HTMLElement).innerText)).toBe(
    'Intro line one before the first section.\nIntro line two, after a single line break.',
  );

  // Every H2 starts open and shows how many items it holds; an H3 does not fold.
  for (const [title, count] of [['Overview', 4], ['Data', 2], ['Pictures', 4], ['Raw HTML', 1]] as const) {
    const heading = panel.getByRole('button', { name: `${title} ${count}` });
    await expect(heading).toHaveAttribute('aria-expanded', 'true');
  }
  await expect(panel.getByRole('heading', { name: 'Detail heading' })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Detail heading' }).getByRole('button')).toHaveCount(0);
  // There is no "open all / close all".
  await expect(details(page).getByRole('button', { name: /(expand|collapse|open|close) all/i })).toHaveCount(0);

  // The list, the checklist, the quote, the struck text, and the inline code.
  await expect(panel.getByRole('listitem')).toHaveText(['first item', 'second item', 'finished task', 'open task']);
  await expect(panel.locator('del')).toHaveText('struck text');
  await expect(panel.getByRole('code').filter({ hasText: 'inline code' })).toBeVisible();
  await expect(panel.locator('blockquote')).toHaveText('A quoted line.');

  // A checklist is shown only: the boxes are disabled, and a click changes nothing.
  const boxes = panel.getByRole('checkbox');
  await expect(boxes).toHaveCount(2);
  await expect(boxes.first()).toBeChecked();
  await expect(boxes.first()).toBeDisabled();
  await expect(boxes.last()).not.toBeChecked();
  await panel.getByText('open task').click({ force: true });
  await expect(boxes.last()).not.toBeChecked();
  expect(JSON.parse(agboardOk(mainProject, ['show', String(id), '--json']).stdout).card.description).toContain('- [ ] open task');

  // A wide table and a long code line scroll sideways inside the column; the page itself does not.
  const table = panel.getByRole('table');
  const tableBox = table.locator('xpath=..');
  expect(await tableBox.evaluate((element) => element.scrollWidth > element.clientWidth + 100)).toBe(true);
  expect(await tableBox.evaluate((element) => getComputedStyle(element).overflowX)).toMatch(/auto|scroll/);
  const codeBlock = panel.locator('pre').first();
  expect(await codeBlock.evaluate((element) => element.scrollWidth > element.clientWidth + 100)).toBe(true);
  expect(await codeBlock.evaluate((element) => getComputedStyle(element).overflowX)).toMatch(/auto|scroll/);
  const panelBox = (await details(page).boundingBox())!;
  expect((await table.boundingBox())!.width).toBeGreaterThan(panelBox.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('H2 sections fold by hand, keep their state across tabs, and open again for another card', async ({ page }) => {
  const id = await addLongCard();
  agboardOk(mainProject, ['add', 'Second card', '--desc', 'No sections here.']);
  await openCard(page, id);
  const panel = body(page);

  await fold(page, 'Overview').click();
  await expect(fold(page, 'Overview')).toHaveAttribute('aria-expanded', 'false');
  await expect(panel.getByText('first item')).toBeHidden();
  await expect(panel.getByText('Detail heading')).toBeHidden();
  // The text before the first H2 and the other sections are still there.
  await expect(panel.getByText('Intro line one before the first section.')).toBeVisible();
  await expect(fold(page, 'Data')).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.getByRole('table')).toBeVisible();

  // A look at the history and back keeps the fold.
  await details(page).getByRole('tab', { name: /^History/ }).click();
  await details(page).getByRole('tab', { name: 'Description' }).click();
  await expect(fold(page, 'Overview')).toHaveAttribute('aria-expanded', 'false');

  // Opening it again by hand works, and a section can be shut and reopened.
  await fold(page, 'Data').click();
  await expect(panel.getByRole('table')).toBeHidden();
  await fold(page, 'Data').click();
  await expect(panel.getByRole('table')).toBeVisible();

  // Another card, then back: every section is open again.
  await card(page, id + 1).click();
  await expect(details(page).getByRole('heading', { level: 2 })).toHaveText('Second card');
  await expect(panel).toContainText('No sections here.');
  await expect(panel.getByRole('button', { name: /\d$/ })).toHaveCount(0);
  await card(page, id).click();
  await expect(fold(page, 'Overview')).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.getByText('first item')).toBeVisible();
});

test('a body without H2 headings is shown whole, and an empty body says so', async ({ page }) => {
  const id = nextCardId(mainProject);
  agboardOk(mainProject, ['add', 'Plain card', '--desc', '### Only a small heading\n\nBody text.\n\n- one\n- two']);
  await page.goto('/');
  await waitForSync(page);
  await card(page, id).click();
  await expect(body(page).getByRole('heading', { name: 'Only a small heading' })).toBeVisible();
  await expect(body(page).getByText('Body text.')).toBeVisible();
  await expect(body(page).getByRole('button')).toHaveCount(0);

  // A card without a description.
  await card(page, 12).click();
  await expect(body(page)).toHaveText('No description.');
});

test('links open in a new tab without handing over the page, and other schemes stay text', async ({ page }) => {
  const id = await addLongCard();
  await openCard(page, id);
  const panel = body(page);

  const safe = panel.getByRole('link', { name: 'safe link' });
  await expect(safe).toHaveAttribute('href', `${images.origin}/page.html`);
  await expect(safe).toHaveAttribute('target', '_blank');
  const rel = (await safe.getAttribute('rel')) ?? '';
  expect(rel).toContain('noopener');
  expect(rel).toContain('noreferrer');

  const [popup] = await Promise.all([page.waitForEvent('popup'), safe.click()]);
  await popup.waitForLoadState();
  expect(popup.url()).toBe(`${images.origin}/page.html`);
  await expect(popup.getByRole('heading', { name: 'Linked page' })).toBeVisible();
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await popup.close();
  await expect(details(page).getByRole('heading', { level: 2 })).toHaveText('Long markdown');

  // `javascript:` is not a link at all: its label is plain text.
  await expect(panel.getByRole('link', { name: 'unsafe link' })).toHaveCount(0);
  await expect(panel.getByText('unsafe link')).toBeVisible();
  await expect(panel.locator('a[href^="javascript"]')).toHaveCount(0);
});

test('only external http(s) images are fetched, without a Referer; everything else is a No image placeholder', async ({
  page,
}) => {
  const id = await addLongCard();
  await openCard(page, id);
  const panel = body(page);
  await panel.getByRole('button', { name: /^Pictures/ }).scrollIntoViewIfNeeded();

  const picture = panel.getByRole('img', { name: 'sample picture' });
  await expect(picture).toBeVisible();
  await expect.poll(() => picture.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect(await picture.getAttribute('src')).toBe(`${images.origin}/ok.png`);

  // A missing file, a file that is not an image, and a data: URL are all placeholders.
  await expect(panel.getByText('No image')).toHaveCount(3);
  await expect(panel.getByRole('img', { name: 'missing picture' })).toHaveCount(0);
  await expect(panel.getByRole('img', { name: 'text picture' })).toHaveCount(0);
  await expect(panel.getByRole('img', { name: 'local picture' })).toHaveCount(0);

  // The sample server saw each fetch, and none carried a Referer. The data: URL was never fetched.
  await expect.poll(() => images.paths.sort()).toEqual(['/missing.png', '/not-an-image.png', '/ok.png']);
  expect(images.referers).toEqual([null, null, null]);
});

test('raw HTML is shown as text and never runs', async ({ page }) => {
  const id = await addLongCard();
  await openCard(page, id);
  await expect(body(page).getByText('<script>window.__injected = true</script><b>not bold</b>')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __injected?: boolean }).__injected)).toBeUndefined();
  await expect(body(page).locator('script, b')).toHaveCount(0);
});

test('the page loads nothing from outside, and answers with the security headers', async ({ page, request }) => {
  const requested: string[] = [];
  page.on('request', (item) => requested.push(item.url()));
  const id = await addLongCard();
  await openCard(page, id);
  await expect(body(page).getByRole('img', { name: 'sample picture' })).toBeVisible();
  const hosts = new Set(requested.map((url) => new URL(url).origin));
  // The page's own server and the sample image server only.
  expect([...hosts].sort()).toEqual(['http://127.0.0.1:7631', images.origin].sort());

  const response = await request.get('/');
  const policy = response.headers()['content-security-policy'];
  expect(policy).toBeTruthy();
  // Scripts, fonts, and connections come from the page's own server only; a script cannot be inlined.
  expect(policy).toContain("script-src 'self';");
  expect(policy).toContain("font-src 'self';");
  expect(policy).toContain("connect-src 'self';");
  expect(policy).toContain("default-src 'none';");
  expect(response.headers()['referrer-policy']).toBe('no-referrer');
});
