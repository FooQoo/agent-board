import { spawnSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { agboardBinary, decisionJson } from '../helpers/agboard';
import {
  createMonitorHome,
  monitorOrigin,
  removeMonitorHome,
  startMonitorServe,
  stopMonitorServe,
  type MonitorServe,
} from '../helpers/monitor';

// The mobile monitor shows an AI card that is pending in Todo with its state and question, like a card in Doing.

test.describe.configure({ mode: 'serial' });
test.use({ baseURL: `${monitorOrigin}/`, viewport: { width: 375, height: 640 } });

let home: string;
let serve: MonitorServe | undefined;

function cli(args: string[]): string {
  const result = spawnSync(agboardBinary(), ['--project', 'Alpha', ...args], {
    env: { ...process.env, AGBOARD_HOME: home, TZ: 'UTC' },
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`agboard ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

test.beforeAll(async () => {
  home = createMonitorHome();
  serve = await startMonitorServe(home);
});

test.afterAll(async () => {
  await stopMonitorServe(serve);
  if (home) removeMonitorHome(home);
});

test('a pending AI task in Todo shows its state and question on the mobile monitor', async ({ page }) => {
  cli(['add', 'Ask before starting on mobile', '--assignee', 'ai', '--actor', 'ai']);
  const tasks = JSON.parse(cli(['ls', '--json'])).tasks as { id: number; title: string }[];
  const id = tasks.find((task) => task.title === 'Ask before starting on mobile')!.id;
  cli(['state', String(id), 'pending', '--actor', 'ai', '--request-json', decisionJson('Which order on mobile?')]);

  await page.goto('/monitor/');
  const task = page.getByText('Ask before starting on mobile').locator('xpath=ancestor::*[contains(@class,"monitor-card")][1]');
  await expect(task).toContainText('Which order on mobile?');
  await expect(task).toContainText('Pending');
});

test('the mobile monitor shows how many conditions of a task are done', async ({ page }) => {
  const description = '---\nacceptance:\n  - id: AC-1\n    text: First\n    done: true\n  - id: AC-2\n    text: Second\n    done: false\n---\n\nBody.\n';
  cli(['add', 'Conditions on mobile', '--assignee', 'ai', '--actor', 'ai', '--desc', description]);

  await page.goto('/monitor/');
  const task = page.getByText('Conditions on mobile').locator('xpath=ancestor::*[contains(@class,"monitor-card")][1]');
  await expect(task).toContainText('1/2');
  await expect(task.locator('.acceptance-chip')).toHaveAttribute('title', 'Acceptance conditions 1 / 2');
});
