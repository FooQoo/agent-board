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

test('project scope, same IDs, detail history and live updates follow the shared file store', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 640 });
  await page.goto('/monitor/');
  await expect(page.getByRole('region', { name: 'Cards' })).toBeVisible();

  await page.getByRole('button', { name: 'All Projects' }).click();
  await page.getByRole('menuitemradio', { name: 'Beta', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`project=${beta}`));
  await expect(page.getByRole('button', { name: /Beta pending review/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Alpha pending review/ })).toHaveCount(0);

  await page.getByRole('button', { name: /Beta pending review/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Beta · #1');
  await expect(page.getByRole('tabpanel')).toContainText('Same-number project card.');
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goForward();
  await expect(page.getByRole('dialog')).toBeVisible();

  await page.goto('/monitor/');
  await expect(page.getByRole('region', { name: 'Cards' })).toBeVisible();
  run('Alpha', ['mv', '2', 'done', '--actor', 'ai', '--reason', 'Finished during the monitor session']);
  await expect(page.getByRole('region', { name: 'Work summary' }).getByRole('button', { name: '2 Running' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Work summary' }).getByRole('button', { name: '10 Done' })).toBeVisible();

  const markdown = pathFor('Alpha', 2, 'TASK.md');
  replaceFileAtomically(markdown, '## 作業内容\n\nChanged directly in shared files.\n\n## 完了条件と確認結果\n\n- [ ] AC-1. Check refresh\n  - 確認結果: done\n  - 根拠: shared file edit\n  - 調整役の確認: yes\n\n## 実行記録\n\n');
  await page.getByRole('button', { name: /Alpha running one/ }).click();
  await expect(page.getByText('Changed directly in shared files.')).toBeVisible();
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
  await expect(page.getByRole('button', { name: /Alpha pending review/ })).toBeVisible();
});

test('monitor details expose no write controls and all write methods fail without changing data', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 640 });
  await page.goto('/monitor/');
  await page.getByRole('button', { name: /Alpha pending review/ }).click();
  const detail = page.getByRole('complementary', { name: 'Card details' });
  await expect(detail).toBeVisible();
  await expect(detail.getByRole('button', { name: /edit|archive|delete|restore|answer|add card/i })).toHaveCount(0);
  const before = await page.request.get(`/monitor/api/projects/${alpha}/board`).then((response) => response.text());
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await page.request.fetch(`/monitor/api/projects/${alpha}/cards/1`, { method });
    expect(response.status(), `${method} must be rejected by the read-only router`).toBe(405);
  }
  const after = await page.request.get(`/monitor/api/projects/${alpha}/board`).then((response) => response.text());
  expect(after).toBe(before);
});
