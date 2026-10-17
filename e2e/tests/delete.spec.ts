import { expect, test, type Page } from '@playwright/test';
import { agboardOk, agboardOnTerminal, listTasks, mainProject, nextTaskId, resetBoard } from '../helpers/agboard';

// Card IDs are never reused, so the disposable card gets whatever number is next after the reset.
let disposable: number;
let ask: string;

test.beforeEach(async ({ page }) => {
  resetBoard(mainProject);
  disposable = nextTaskId(mainProject);
  ask = `Archive #${disposable} "Disposable task"? You can restore it from the archive.`;
  agboardOk(mainProject, ['add', 'Disposable task', '--desc', 'Delete me']);
  await page.goto('/');
  await expect(page.getByRole('contentinfo').getByRole('status')).toHaveText(/^Synced/);
});

const panel = (page: Page) => page.getByRole('complementary', { name: 'Task details' });
const task = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });

test('Cancel closes the archive confirmation and keeps the task', async ({ page }) => {
  await task(page, disposable).click();
  await panel(page).getByRole('button', { name: 'Archive task' }).click();

  const confirm = panel(page).getByRole('group', { name: ask });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText(ask);
  await expect(confirm.getByRole('button', { name: 'Archive', exact: true })).toBeVisible();

  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Disposable task');
  await expect(task(page, disposable)).toBeVisible();
  expect(listTasks(mainProject).map((c) => c.id)).toContain(disposable);
});

test('archive removes the task from the board and clears the selection', async ({ page }) => {
  await task(page, disposable).click();
  await panel(page).getByRole('button', { name: 'Archive task' }).click();
  await panel(page).getByRole('button', { name: 'Archive', exact: true }).click();

  await expect(panel(page)).toContainText('Select a task to see its details.');
  await expect(task(page, disposable)).toHaveCount(0);
  await expect(page.getByRole('contentinfo')).toContainText('8 tasks');
  expect(listTasks(mainProject).map((c) => c.id)).not.toContain(disposable);
  // The numbering goes on; IDs are never reused.
  expect(JSON.parse(agboardOk(mainProject, ['add', 'Next', '--json']).stdout).task.id).toBe(disposable + 1);
});

test('a task the CLI deletes while selected clears the selection', async ({ page }) => {
  await task(page, 15).click();
  await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Write the setup guide');

  // A person at a terminal confirms the deletion with y.
  const result = agboardOnTerminal(mainProject, 'y', ['rm', '15']);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('Deleted #15.');

  await expect(panel(page)).toContainText('Select a task to see its details.');
  await expect(task(page, 15)).toHaveCount(0);
  await expect(page.getByRole('contentinfo')).toContainText('8 tasks');
});
