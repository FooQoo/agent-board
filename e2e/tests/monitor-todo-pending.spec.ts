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

test('a pending AI card in Todo shows its state and question on the mobile monitor', async ({ page }) => {
  cli(['add', 'Ask before starting on mobile', '--assignee', 'ai', '--actor', 'ai']);
  const cards = JSON.parse(cli(['ls', '--json'])).cards as { id: number; title: string }[];
  const id = cards.find((card) => card.title === 'Ask before starting on mobile')!.id;
  cli(['state', String(id), 'pending', '--actor', 'ai', '--request-json', decisionJson('Which order on mobile?')]);

  await page.goto('/monitor/');
  const card = page.getByText('Ask before starting on mobile').locator('xpath=ancestor::*[contains(@class,"monitor-card")][1]');
  await expect(card).toContainText('Which order on mobile?');
  await expect(card).toContainText('Pending');
});
