import { expect, test } from '../helpers/fixtures';
import { agboard, agboardOk, mainProject, resetBoard } from '../helpers/agboard';
import { fillRequest, openAskAi, sendRequest } from '../helpers/ask-ai';
import { waitForSync } from '../helpers/ui';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==',
  'base64',
);

test.beforeEach(async ({ page }) => {
  resetBoard(mainProject);
  await page.goto('/');
  await waitForSync(page);
});

test('a request sent through Ask AI with an image is returned by task wait as a request', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  const dialog = await openAskAi(page);
  const description = 'Investigate the listener request\n\nKeep the source wording intact.';
  await fillRequest(dialog, description);
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'request.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await expect(dialog.getByRole('button', { name: 'Remove request.png' })).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await dialog.screenshot({ path: testInfo.outputPath('task-listen-request-attached.png') });
  await page.screenshot({ path: testInfo.outputPath('task-listen-request-attached-viewport.png') });
  await sendRequest(dialog);

  // A request is not a task: no card appears, and the wait returns the request before any task.
  const snapshot = JSON.parse(agboardOk(mainProject, ['snapshot', '--json']).stdout) as { tasks: { title: string }[] };
  expect(snapshot.tasks.map(({ title }) => title)).not.toContain('Investigate the listener request');

  const waited = agboard(mainProject, ['wait', '--until', 'task', '--idle-timeout', '1', '--json']);
  expect(waited.code, waited.stderr).toBe(0);
  expect(waited.stderr).toBe('');
  const selected = JSON.parse(waited.stdout) as {
    kind: string;
    cursor: string;
    requests: { id: string; createdAt: string; title: string }[];
  };
  expect(selected.kind).toBe('requests');
  expect(selected.requests).toHaveLength(1);
  expect(selected.requests[0].title).toBe('Investigate the listener request');

  // The agent reads the whole text and its image with message show, and the next wait returns the same request until it is accepted.
  const shown = JSON.parse(agboardOk(mainProject, ['message', 'show', selected.requests[0].id, '--json']).stdout) as {
    request: { body: string; status: string; from: string };
  };
  expect(shown.request.body).toContain('Keep the source wording intact.');
  expect(shown.request.status).toBe('open');
  const again = JSON.parse(agboard(mainProject, ['wait', '--until', 'task', '--idle-timeout', '1', '--json']).stdout) as { kind: string };
  expect(again.kind).toBe('requests');
  agboardOk(mainProject, ['message', 'accept', selected.requests[0].id, '--actor', 'ai', '--json']);
  // An accepted request no longer wakes the wait: the board's own todo task is returned instead.
  const next = JSON.parse(agboard(mainProject, ['wait', '--until', 'task', '--idle-timeout', '1', '--json']).stdout) as { kind: string };
  expect(next.kind).not.toBe('requests');
});
