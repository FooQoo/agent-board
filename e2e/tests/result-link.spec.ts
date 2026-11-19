import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { agboardOk, makeHome, projectId, removeHome, resetAlphaBeta, startServe, stopServe, type Serve } from '../helpers/agboard';
import { expect, test } from '../helpers/fixtures';

// A result link opens the phone task detail on the delivered result: `/?project=<id>&task=<n>&result=<version>`.
// An iPhone-sized touch screen; the CLI, the server and the browser are real.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
test.describe.configure({ mode: 'serial' });

let serve: Serve | undefined;
let home: string;
let alpha: string;
let beta: string;

const start = async (): Promise<Serve> => {
  if (!serve) {
    home = makeHome('result-link');
    serve = await startServe(home);
  }
  return serve;
};
test.use({ baseURL: async ({}, use) => use((await start()).url) });
test.beforeAll(async () => {
  await start();
  resetAlphaBeta(home, serve!.url);
  alpha = projectId('Alpha', home);
  beta = projectId('Beta', home);
  const image = path.join(mkdtempSync(path.join(os.tmpdir(), 'result-link-')), 'capture.png');
  writeFileSync(
    image,
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==', 'base64'),
  );
  // Task 1 of Alpha: a first text-only result, then a final one with a capture and a link that exists only on the PC.
  agboardOk('Alpha', ['result', 'add', '1', '--summary', 'First draft of the notes is written.', '--actor', 'ai'], home);
  agboardOk(
    'Alpha',
    ['result', 'add', '1', '--summary', 'The notes are final; the full report is on the PC.', '--file', image, '--link', 'outputs/release-notes/report.html', '--final', '--actor', 'ai'],
    home,
  );
});
test.afterAll(async () => {
  await stopServe(serve);
  serve = undefined;
  removeHome(home);
});

const linkTo = (project: string, task: number, version: number) => `/?project=${project}&task=${task}&result=${version}`;

test('a link to a result with an image opens it directly, even from another project', async ({ page }) => {
  // The phone was showing another project.
  await page.goto(`/?project=${beta}`);
  await expect(page).toHaveTitle('Beta - Agent Board');

  await page.goto(linkTo(alpha, 1, 2));
  await expect(page).toHaveTitle('Alpha - Agent Board');
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('tab', { name: 'Results' })).toHaveAttribute('aria-selected', 'true');
  const target = drawer.locator('[data-result-version="2"]');
  await expect(target).toHaveAttribute('data-focused', 'true');
  await expect(target).toContainText('Final');
  await expect(target).toContainText('The notes are final');
  await expect(target).toContainText('outputs/release-notes/report.html');
  await expect(target.locator('img')).toBeVisible();
  expect(await target.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  // The older result is listed below the newest one.
  const versions = await drawer.locator('[data-result-version]').evaluateAll((items) => items.map((item) => item.getAttribute('data-result-version')));
  expect(versions).toEqual(['2', '1']);
  // The picture opens larger.
  await target.getByRole('button', { name: /Enlarge/ }).click();
  await expect(page.getByRole('dialog').last().locator('img')).toBeVisible();
});

test('a link to a text-only result shows its summary and highlights that version', async ({ page }) => {
  await page.goto(linkTo(alpha, 1, 1));
  const drawer = page.getByRole('dialog');
  const target = drawer.locator('[data-result-version="1"]');
  await expect(target).toHaveAttribute('data-focused', 'true');
  await expect(target).toContainText('In progress');
  await expect(target).toContainText('First draft of the notes is written.');
  await expect(target.locator('img')).toHaveCount(0);
  await expect(drawer.locator('[data-result-version="2"]')).not.toHaveAttribute('data-focused', 'true');
});

test('closing the drawer takes the link out of the address, and a damaged link opens the plain board', async ({ page }) => {
  await page.goto(linkTo(alpha, 1, 2));
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get('task')).toBeNull();
  expect(new URL(page.url()).searchParams.get('project')).toBe(alpha);

  await page.goto(`/?project=${alpha}&task=abc&result=2`);
  await expect(page).toHaveTitle('Alpha - Agent Board');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a history link opens the card on its History tab', async ({ page }) => {
  await page.goto(`/?project=${alpha}&task=1&tab=history`);
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get('tab')).toBeNull();
  expect(new URL(page.url()).searchParams.get('task')).toBeNull();
});

test('a question link opens that question, and a question that is gone opens the card', async ({ page }) => {
  const asked = agboardOk(
    'Alpha',
    ['message', 'ask', '--actor', 'ai', '--no-wait', '--task', '1', '--questions-json', JSON.stringify({ questions: [{ body: 'Which title should the notes use?' }] })],
    home,
  );
  const id = /Q-\d+/.exec(`${asked.stdout}${asked.stderr}`)?.[0];
  expect(id).toBeTruthy();
  // The board lists a new question once its index has caught up; a link opened before that shows the
  // card, so the first look is repeated until the question is there.
  const dialog = page.getByRole('dialog');
  await expect(async () => {
    await page.goto(`/?project=${alpha}&task=1&question=${id}`);
    await expect(dialog).toContainText('Which title should the notes use?', { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });

  await page.goto(`/?project=${alpha}&task=1&question=Q-999`);
  await expect(page.getByRole('dialog').getByRole('tab', { name: 'Results' })).toBeVisible();
});
