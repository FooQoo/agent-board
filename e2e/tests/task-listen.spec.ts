import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { agboard, agboardOk, mainProject, resetBoard, workspace } from '../helpers/agboard';
import { waitForSync } from '../helpers/ui';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==',
  'base64',
);

test.beforeEach(async ({ page }) => {
  resetBoard(mainProject);
  agboardOk(mainProject, ['epic', 'add', 'LISTEN', '--name', 'Listening', '--actor', 'ai']);
  await page.goto('/');
  await waitForSync(page);
});

test('a submitted request with an epic and image is returned by task wait as an ordinary AI task', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  const description = 'Investigate the listener request\nKeep the source wording intact.';
  await dialog.getByRole('textbox', { name: 'What should be done?' }).fill(description);

  await dialog.getByRole('button', { name: 'Epic (optional)' }).click();
  await page.getByRole('menuitemradio', { name: 'Listening' }).click();
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'request.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await expect(dialog.getByRole('button', { name: 'Preview request.png' })).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await dialog.screenshot({ path: testInfo.outputPath('task-listen-request-attached.png') });
  await page.screenshot({ path: testInfo.outputPath('task-listen-request-attached-viewport.png') });
  await dialog.getByRole('button', { name: 'Submit task' }).click();
  await expect(dialog).toHaveCount(0);

  const snapshot = JSON.parse(agboardOk(mainProject, ['snapshot', '--json']).stdout) as {
    tasks: { id: number; title: string; assignee: string; taskStatus: string; agentStatus: string; epicId: string | null }[];
  };
  const created = snapshot.tasks.find((task) => task.title === 'Investigate the listener request');
  expect(created).toMatchObject({
    title: 'Investigate the listener request',
    assignee: 'ai',
    taskStatus: 'todo',
    agentStatus: 'idle',
    epicId: 'LISTEN',
  });
  if (!created) throw new Error('The submitted request was not stored as a task.');

  const waited = agboard(mainProject, ['wait', '--until', 'task', '--idle-timeout', '1', '--json']);
  expect(waited.code, waited.stderr).toBe(0);
  expect(waited.stderr).toBe('');
  const selected = JSON.parse(waited.stdout) as {
    kind: string;
    task: { id: number; title: string; taskStatus: string; agentStatus: string };
    taskPath: string;
    documentPath: string | null;
  };
  expect(selected.kind).toBe('task');
  expect(selected.task).toMatchObject({
    id: created.id,
    title: 'Investigate the listener request',
    taskStatus: 'todo',
    agentStatus: 'idle',
  });
  expect(selected.taskPath).toContain('/tasks/');
  expect(selected.taskPath.endsWith('/TASK.md')).toBe(true);
  expect(selected.documentPath).not.toBeNull();

  const taskMarkdown = readFileSync(selected.taskPath, 'utf8');
  expect(taskMarkdown).toContain('## 元の依頼');
  expect(taskMarkdown).toContain(description);
  const attachment = JSON.parse(
    agboardOk(mainProject, ['show', String(created.id), '--json']).stdout,
  ) as { task: { attachments: { name: string }[] } };
  expect(attachment.task.attachments.map(({ name }) => name)).toContain('request.png');
  expect(workspace(mainProject).folder).toContain('projects');
});
