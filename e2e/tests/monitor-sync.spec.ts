import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  agboardBinary,
  replaceFileAtomically,
  workspace,
} from '../helpers/agboard';
import {
  createMonitorHome,
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

function run(project: string, args: string[]): void {
  const result = spawnSync(agboardBinary(), ['--project', project, ...args], {
    cwd: home,
    env: { ...process.env, AGBOARD_HOME: home, TZ: 'UTC' },
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`agboard ${args.join(' ')} failed: ${result.stderr}`);
}

test('project scope, same IDs and live updates follow the shared file store', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 640 });
  await page.goto('/monitor/');
  await expect(page.getByRole('region', { name: 'Cards' })).toBeVisible();

  await page.getByRole('button', { name: 'All Projects' }).click();
  await page.getByRole('menuitemradio', { name: 'Beta', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`project=${beta}`));
  await expect(page.getByRole('article', { name: /Beta pending review/ })).toBeVisible();
  await expect(page.getByRole('article', { name: /Alpha pending review/ })).toHaveCount(0);

  await page.getByRole('article', { name: /Beta pending review/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`project=${beta}$`));
  await page.goBack();
  await expect(page.getByRole('button', { name: 'All Projects' })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('button', { name: 'Beta', exact: true })).toBeVisible();

  await page.goto('/monitor/');
  await expect(page.getByRole('region', { name: 'Cards' })).toBeVisible();
  run('Alpha', ['mv', '2', 'done', '--actor', 'ai', '--reason', 'Finished during the monitor session']);
  await expect(page.getByRole('region', { name: 'Work summary' }).getByRole('button', { name: '2 Running' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Work summary' }).getByRole('button', { name: '10 Done' })).toBeVisible();

  const taskFile = pathFor('Alpha', 2, 'task.json');
  const task = JSON.parse(readFileSync(taskFile, 'utf8'));
  replaceFileAtomically(taskFile, JSON.stringify({ ...task, title: 'Changed directly in shared files' }));
  await expect(page.getByRole('article', { name: /Changed directly in shared files/ })).toHaveCount(1);
});

function pathFor(project: string, id: number, name: string): string {
  return `${workspace(project, home).folder}/tasks/${id}/${name}`;
}

test('partial shared-file damage is reported without inventing zero counts, then recovers', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 640 });
  await page.goto('/monitor/');
  await expect(page.getByRole('region', { name: 'Cards' })).toBeVisible();
  const taskFile = pathFor('Alpha', 1, 'task.json');
  const original = readFileSync(taskFile, 'utf8');
  replaceFileAtomically(taskFile, '{ invalid json');
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('region', { name: 'Work summary' })).toContainText('—');
  await expect(page.getByRole('region', { name: 'Work summary' })).not.toContainText('0 Pending');
  await expect(page.getByText(/partial|problem|issue/i).first()).toBeVisible();

  replaceFileAtomically(taskFile, original);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('region', { name: 'Work summary' }).getByRole('button', { name: '2 Pending' })).toBeVisible();
  await expect(page.getByRole('article', { name: /Alpha pending review/ })).toBeVisible();
});

test('monitor overview exposes no detail or write controls and all write methods fail without changing data', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 640 });
  await page.goto('/monitor/');
  await page.getByRole('article', { name: /Alpha pending review/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /edit|archive|delete|restore|answer|add card/i })).toHaveCount(0);
  const before = await page.request.get(`/monitor/api/projects/${alpha}/board`).then((response) => response.text());
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await page.request.fetch(`/monitor/api/projects/${alpha}/cards/1`, { method });
    expect(response.status(), `${method} must be rejected by the read-only router`).toBe(405);
  }
  const after = await page.request.get(`/monitor/api/projects/${alpha}/board`).then((response) => response.text());
  expect(after).toBe(before);
});
