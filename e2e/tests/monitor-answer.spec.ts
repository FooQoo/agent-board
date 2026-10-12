import { spawnSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { agboardBinary, decisionJson } from '../helpers/agboard';
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
test.use({ baseURL: `${monitorOrigin}/`, viewport: { width: 375, height: 640 } });

let home: string;
let projectId: string;
let serve: MonitorServe | undefined;

function cli(args: string[]): string {
  const result = spawnSync(agboardBinary(), ['--project', 'Alpha', ...args], {
    env: { ...process.env, AGBOARD_HOME: home, TZ: 'UTC' },
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`agboard ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

function show(id: number) {
  return JSON.parse(cli(['show', String(id), '--json'])).card as {
    cardStatus: string;
    agentStatus: string;
    pendingRequestId: string | null;
    history: { actor: string; reason: string | null }[];
  };
}

test.beforeAll(async () => {
  home = createMonitorHome();
  projectId = monitorProjectId(home, 'Alpha');
  serve = await startMonitorServe(home);
});

test.afterAll(async () => {
  await stopMonitorServe(serve);
  if (home) removeMonitorHome(home);
});

test('answers Todo and Doing requests through the monitor API and records them in shared files', async ({
  page,
}) => {
  cli(['add', 'Todo answer on mobile', '--assignee', 'ai', '--actor', 'ai']);
  const todoCard = JSON.parse(cli(['ls', '--json'])).cards.find(
    (card: { title: string }) => card.title === 'Todo answer on mobile',
  ) as { id: number };
  cli([
    'state',
    String(todoCard.id),
    'pending',
    '--actor',
    'ai',
    '--request-json',
    decisionJson('Choose before work starts.'),
  ]);

  // The remote write guard requires HTTPS Origin/Host headers from its trusted reverse proxy.
  // The test listener is HTTP, so forward the browser's real request through the API client while
  // supplying exactly the headers that the configured trusted HTTPS origin would preserve.
  await page.route('**/monitor/api/projects/*/cards/*/answer', async (route) => {
    const target = route.request().url();
    const token = await page.locator('meta[name="agboard-monitor-token"]').getAttribute('content');
    const upstream = await page.request.post(target, {
      headers: {
        Host: 'monitor.e2e.invalid',
        Origin: 'https://monitor.e2e.invalid',
        'Sec-Fetch-Site': 'same-origin',
        'X-Agboard-Token': token ?? '',
      },
      data: route.request().postDataJSON(),
    });
    await route.fulfill({ response: upstream });
  });

  await page.goto('/monitor/');
  const cards = [
    { id: 1, title: 'Alpha pending review', answer: 'Reviewed in Doing.' },
    { id: todoCard.id, title: 'Todo answer on mobile', answer: 'Reviewed in Todo.' },
  ];
  for (const item of cards) {
    const card = page.getByRole('article', { name: new RegExp(item.title) });
    await expect(card).toContainText('Pending');
    await card.getByRole('textbox', { name: 'Your answer' }).fill(item.answer);
    const requestPath = `/monitor/api/projects/${projectId}/cards/${item.id}/answer`;
    const responsePromise = page.waitForResponse(
      (response) => response.url().endsWith(requestPath) && response.request().method() === 'POST',
    );
    await card.getByRole('button', { name: 'Send', exact: true }).click();
    const response = await responsePromise;
    expect(response.status(), await response.text()).toBe(200);
    await expect(card).not.toContainText('Pending');

    const stored = show(item.id);
    expect(stored).toMatchObject({
      cardStatus: item.id === 1 ? 'doing' : 'todo',
      agentStatus: 'idle',
      pendingRequestId: null,
    });
    expect(stored.history.at(-1)).toMatchObject({ actor: 'human', reason: item.answer });
  }
});
