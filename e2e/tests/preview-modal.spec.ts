import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { agboard, agboardOk, mainProject, nextTaskId, resetBoard, taskBody, workspace } from '../helpers/agboard';
import { archiveTask, putDraft } from '../helpers/drafts';
import { readBoardAfterReset, waitForSync } from '../helpers/ui';

// The preview dialog of a task and of an epic on the real page and the real server: opening only reads, the
// first change makes a draft the CLI refuses, a discard takes the draft back, a running task is read-only, and a
// change that slipped in while the dialog was open stops the save. The CLI shows what is stored.

const details = (page: Page) => page.getByRole('complementary', { name: 'Task details' });
const task = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });
const previewOf = (page: Page, id: number) => page.getByRole('dialog', { name: new RegExp(`^#${id} Task preview`) });
const previewButton = (page: Page) => details(page).getByRole('button', { name: 'Open full screen (task)', exact: true });
const titleField = (dialog: Locator) => dialog.getByRole('textbox', { name: 'Title', exact: true });
const saveButton = (dialog: Locator) => dialog.getByRole('button', { name: 'Save', exact: true });

const LOCKED = "You have unsaved changes. Agents can't change this task until you save.";
const BODY = taskBody('## Work\n\nOriginal text.\n\n## Notes\n\nKept.');

interface ShownTask {
  id: number;
  title: string;
  description: string;
  isDraft: boolean;
  taskStatus: string;
  agentStatus: string;
  history: { at: string; reason: string }[];
}

function show(id: number): ShownTask {
  return JSON.parse(agboardOk(mainProject, ['show', String(id), '--json']).stdout).task;
}

function taskFile(id: number): string {
  return path.join(workspace(mainProject).folder, 'tasks', String(id), 'TASK.md');
}

function addTask(title: string): number {
  const id = nextTaskId(mainProject);
  agboardOk(mainProject, ['add', title, '--desc', BODY, '--assignee', 'ai', '--actor', 'human']);
  return id;
}

async function openBoard(page: Page): Promise<void> {
  await page.goto('/');
  await waitForSync(page);
  await readBoardAfterReset(page);
}

async function openPreview(page: Page, id: number): Promise<Locator> {
  await task(page, id).click();
  await previewButton(page).click();
  const dialog = previewOf(page, id);
  await expect(dialog).toBeVisible();
  // The rich editor loads the text after the dialog opens; a change typed before that is lost.
  await expect(dialog.getByRole('textbox', { name: 'Description (Markdown)' }).getByText('Original text.')).toBeVisible();
  return dialog;
}

/** Slows the page's reads of the board, so a change made in the meantime is not seen by the open dialog yet. */
async function slowReads(page: Page, ms: number): Promise<void> {
  const slow = async (route: import('@playwright/test').Route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue().catch(() => undefined);
  };
  await page.route('**/api/projects/*/summary**', slow);
  await page.route('**/api/projects/*/tasks/*/detail**', slow);
}

test.beforeEach(() => {
  resetBoard(mainProject);
});

test('PM-1 opening and closing a preview only reads: no draft, no history, no file change', async ({ page }) => {
  const id = addTask('Read only by opening');
  await openBoard(page);
  const before = readFileSync(taskFile(id), 'utf8');
  const shown = show(id);

  // The toolbar has Preview and no Make draft.
  await task(page, id).click();
  await expect(details(page).getByRole('button', { name: 'Make draft' })).toHaveCount(0);
  await expect(details(page).getByRole('button', { name: 'Edit task' })).toHaveCount(0);
  await expect(previewButton(page)).toBeVisible();

  await previewButton(page).click();
  const dialog = previewOf(page, id);
  await expect(dialog).toContainText('Task preview');
  await expect(titleField(dialog)).toHaveValue('Read only by opening');
  await expect(saveButton(dialog)).toBeDisabled();
  await expect(dialog.getByText(LOCKED)).toHaveCount(0);
  await expect(dialog.getByText('Draft', { exact: true })).toHaveCount(0);
  // The button reads Close, not Cancel, while nothing differs.
  await expect(dialog.getByRole('button', { name: 'Close', exact: true }).first()).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
  // Nothing is stored while it is open.
  expect(show(id).isDraft).toBe(false);

  await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(dialog).toHaveCount(0);
  expect(readFileSync(taskFile(id), 'utf8')).toBe(before);
  expect(show(id)).toEqual(shown);
  await expect(details(page).getByRole('region', { name: 'Draft' })).toHaveCount(0);
});

test('PM-2 the first change makes a draft the CLI refuses, and saving gives the task back', async ({ page }) => {
  const id = addTask('Changed in the preview');
  await openBoard(page);
  const dialog = await openPreview(page, id);

  await titleField(dialog).fill('Changed in the preview, again');
  // The draft chip and the notice, in the footer; Save is on.
  await expect(dialog.getByText('Draft', { exact: true })).toBeVisible();
  await expect(dialog.getByText(LOCKED)).toBeVisible();
  await expect(saveButton(dialog)).toBeEnabled();
  await expect.poll(() => show(id).isDraft).toBe(true);

  // The agent's CLI is refused, in text and in the machine-readable error.
  const refused = agboard(mainProject, ['edit', String(id), '--title', 'By an agent']);
  expect(refused.code).toBe(1);
  expect(refused.stderr).toContain(`task #${id} is a draft and read-only for agents.`);
  const json = agboard(mainProject, ['edit', String(id), '--title', 'By an agent', '--json']);
  expect(JSON.parse(json.stderr || json.stdout).error.code).toBe('task_is_draft');
  expect(show(id).title).toBe('Changed in the preview');

  // Saving stores the change and hands the task back.
  await saveButton(dialog).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => show(id).isDraft).toBe(false);
  expect(show(id).title).toBe('Changed in the preview, again');
  expect(agboard(mainProject, ['edit', String(id), '--title', 'By an agent after']).code).toBe(0);
});

test('PM-2 Cmd+S and Ctrl+S save like the Save button, from the title and from the body', async ({ page }) => {
  const id = addTask('Saved with the keys');
  await openBoard(page);

  // Nothing to save yet: the keys change nothing, and the dialog stays.
  let dialog = await openPreview(page, id);
  await page.keyboard.press('Control+s');
  await expect(dialog).toBeVisible();
  expect(show(id).isDraft).toBe(false);

  await titleField(dialog).fill('Saved with Ctrl+S');
  await expect(saveButton(dialog)).toBeEnabled();
  await page.keyboard.press('Control+s');
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => show(id).isDraft).toBe(false);
  expect(show(id).title).toBe('Saved with Ctrl+S');

  // The rich editor keeps the keys from nobody: the same keys save from the body.
  await page.getByRole('button', { name: 'Close details' }).click();
  dialog = await openPreview(page, id);
  await dialog.getByRole('textbox', { name: 'Description (Markdown)' }).getByText('Original text.').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Typed.');
  await expect(saveButton(dialog)).toBeEnabled();
  await page.keyboard.press('Meta+s');
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => show(id).description).toContain('Original text. Typed.');
});

test('PM-3 discarding takes the draft back, with the discard in the history and no finalize', async ({ page }) => {
  const id = addTask('Discarded in the preview');
  await openBoard(page);
  let dialog = await openPreview(page, id);

  await titleField(dialog).fill('Typed and discarded');
  await expect.poll(() => show(id).isDraft).toBe(true);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Discard and close' }).click();
  await expect(dialog).toHaveCount(0);

  // The real server took the discard: the draft is gone, the title is as before, and the history says so.
  await expect.poll(() => show(id).isDraft).toBe(false);
  const reasons = show(id).history.map((note) => note.reason);
  expect(reasons).toContain('Marked task as draft.');
  expect(reasons).toContain('Discarded draft changes.');
  expect(reasons).not.toContain('Finalized task draft.');
  expect(show(id).title).toBe('Discarded in the preview');

  // Typing back to the original keeps the draft until the dialog closes, and closing takes it back.
  dialog = await openPreview(page, id);
  await titleField(dialog).fill('Briefly different');
  await expect.poll(() => show(id).isDraft).toBe(true);
  await titleField(dialog).fill('Discarded in the preview');
  await expect(dialog.getByRole('button', { name: 'Close', exact: true }).first()).toBeVisible();
  expect(show(id).isDraft).toBe(true);
  await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => show(id).isDraft).toBe(false);

  // A task that was a draft before stays a draft after a discard.
  agboardOk(mainProject, ['edit', String(id), '--title', 'Draft from before']);
  await putDraft(id);
  await openBoard(page);
  dialog = await openPreview(page, id);
  await titleField(dialog).fill('Typed over a draft');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Discard and close' }).click();
  await expect(dialog).toHaveCount(0);
  expect(show(id)).toMatchObject({ isDraft: true, title: 'Draft from before' });
});

test('PM-4 a running task opens read-only, and a task that starts running turns the preview read-only', async ({ page }) => {
  const running = addTask('Already running');
  agboardOk(mainProject, ['mv', String(running), 'doing', '--actor', 'ai', '--reason', 'Start']);
  agboardOk(mainProject, ['state', String(running), 'running', '--actor', 'ai', '--reason', 'Working']);
  const idle = addTask('Starts running later');
  await openBoard(page);

  // Opened while running: the chip and the reason, inputs off, nothing to save.
  await task(page, running).click();
  await previewButton(page).click();
  let dialog = previewOf(page, running);
  await expect(dialog).toHaveAttribute('data-read-only', '');
  await expect(dialog.getByText('Running', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Read-only while an agent is working.')).toBeVisible();
  await expect(titleField(dialog)).toBeDisabled();
  await expect(saveButton(dialog)).toBeDisabled();
  expect(show(running).isDraft).toBe(false);
  await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(dialog).toHaveCount(0);

  // Followed while open: the agent starts, the preview turns read-only; the run ends, it turns back.
  dialog = await openPreview(page, idle);
  agboardOk(mainProject, ['mv', String(idle), 'doing', '--actor', 'ai', '--reason', 'Start']);
  agboardOk(mainProject, ['state', String(idle), 'running', '--actor', 'ai', '--reason', 'Working']);
  await expect(dialog).toHaveAttribute('data-read-only', '', { timeout: 15_000 });
  await expect(titleField(dialog)).toBeDisabled();
  agboardOk(mainProject, ['state', String(idle), 'idle', '--actor', 'ai', '--reason', 'Done working']);
  await expect(titleField(dialog)).toBeEnabled({ timeout: 15_000 });
  await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(dialog).toHaveCount(0);
});

test('PM-4 a run that began before the first change stops the save and keeps the input', async ({ page }) => {
  const id = addTask('Runs under the dialog');
  await openBoard(page);
  const dialog = await openPreview(page, id);

  // The page does not see the change for a while, so the dialog still shows an idle task.
  await slowReads(page, 4_000);
  agboardOk(mainProject, ['mv', String(id), 'doing', '--actor', 'ai', '--reason', 'Start']);
  agboardOk(mainProject, ['state', String(id), 'running', '--actor', 'ai', '--reason', 'Working']);
  await titleField(dialog).fill('Typed while it runs');

  // The server refuses the draft; the input stays; the footer says why and that the change is not saved.
  await expect(dialog.getByText("An agent started working on this task, so it can't be saved.")).toBeVisible();
  await expect(dialog.getByText('You have unsaved changes.')).toBeVisible();
  await expect(titleField(dialog)).toHaveValue('Typed while it runs');
  await expect(saveButton(dialog)).toBeDisabled();
  expect(show(id)).toMatchObject({ isDraft: false, title: 'Runs under the dialog', agentStatus: 'running' });
});

test('PM-5 an untouched preview follows the latest and shows when; a change that slipped in stops the save', async ({
  page,
}) => {
  const followed = addTask('Followed');
  const crossed = addTask('Crossed');
  const statusOnly = addTask('Status only');
  await openBoard(page);

  // Followed: with no difference the preview takes what the agent wrote and says when.
  let dialog = await openPreview(page, followed);
  agboardOk(mainProject, ['edit', String(followed), '--title', 'Followed, as the agent wrote it']);
  await expect(titleField(dialog)).toHaveValue('Followed, as the agent wrote it', { timeout: 15_000 });
  await expect(dialog.getByText(/^Updated at /)).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(dialog).toHaveCount(0);

  // Crossed: the agent wrote after the dialog read, and before the first change was typed.
  dialog = await openPreview(page, crossed);
  await slowReads(page, 4_000);
  agboardOk(mainProject, ['edit', String(crossed), '--title', 'Crossed, by the agent']);
  await titleField(dialog).fill('Crossed, by the person');
  await expect(dialog.getByText("An agent changed this task while it was open, so it can't be saved.")).toBeVisible();
  await expect(dialog.getByText('You have unsaved changes.')).toBeVisible();
  await expect(titleField(dialog)).toHaveValue('Crossed, by the person');
  await expect(saveButton(dialog)).toBeDisabled();
  await page.unroute('**/api/projects/*/summary**');
  await page.unroute('**/api/projects/*/tasks/*/detail**');
  // Closing drops the input and the draft; the agent's text stays.
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Discard and close' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => show(crossed).isDraft).toBe(false);
  expect(show(crossed).title).toBe('Crossed, by the agent');

  // Only the state and the history changed: that is not a crossing, and the change can be saved.
  dialog = await openPreview(page, statusOnly);
  await slowReads(page, 4_000);
  agboardOk(mainProject, ['mv', String(statusOnly), 'doing', '--actor', 'ai', '--reason', 'Start']);
  await titleField(dialog).fill('Status only, saved');
  await expect(dialog.getByText(LOCKED)).toBeVisible();
  await expect(dialog.getByText("An agent changed this task while it was open, so it can't be saved.")).toHaveCount(0);
  await expect(saveButton(dialog)).toBeEnabled();
  await page.unroute('**/api/projects/*/summary**');
  await page.unroute('**/api/projects/*/tasks/*/detail**');
  await saveButton(dialog).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => show(statusOnly).title).toBe('Status only, saved');
  expect(show(statusOnly)).toMatchObject({ isDraft: false, taskStatus: 'doing' });
});

test('PM-6 the epic tab and the epic details open the epic preview; a draft epic is refused by the CLI, discarded and saved on the server', async ({
  page,
}) => {
  agboardOk(mainProject, ['epic', 'add', 'PREVIEWEP', '--name', 'Preview epic', '--color', '#7C3AED', '--actor', 'human']);
  const id = nextTaskId(mainProject);
  agboardOk(mainProject, ['add', 'In the preview epic', '--desc', BODY, '--assignee', 'ai', '--actor', 'human', '--epic', 'PREVIEWEP']);
  await openBoard(page);
  const epic = () => JSON.parse(agboardOk(mainProject, ['epic', 'show', 'PREVIEWEP', '--json']).stdout).epic as {
    name: string;
    isDraft: boolean;
  };
  const epicDialog = page.getByRole('dialog', { name: /Epic preview/ });

  // From the task's epic tab: the heading under the title, with Open full screen.
  await task(page, id).click();
  await details(page).getByRole('tab', { name: /^Epic/ }).click();
  await expect(details(page).getByRole('heading', { name: 'Preview epic', exact: true })).toBeVisible();
  await details(page).getByRole('button', { name: 'Open full screen (epic)' }).click();
  await expect(epicDialog).toBeVisible();
  await expect(epicDialog.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Preview epic');
  await expect(epicDialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  expect(epic().isDraft).toBe(false);
  await epicDialog.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(epicDialog).toHaveCount(0);

  // From the epic details: the pencil.
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByRole('button', { name: 'Epics', exact: true }).click();
  await page.getByRole('list', { name: 'Epics in this project' }).getByRole('listitem').filter({ hasText: 'Preview epic' }).getByRole('button').first().click();
  await page.getByRole('button', { name: 'Edit epic' }).click();
  await expect(epicDialog).toBeVisible();
  const name = epicDialog.getByRole('textbox', { name: 'Title', exact: true });

  // The first change makes a draft, and the CLI is refused.
  await name.fill('Preview epic, changed');
  await expect.poll(() => epic().isDraft).toBe(true);
  const refused = agboard(mainProject, ['epic', 'edit', 'PREVIEWEP', '--name', 'By an agent', '--json']);
  expect(refused.code).toBe(1);
  expect(JSON.parse(refused.stderr || refused.stdout).error.code).toBe('epic_is_draft');
  expect(epic().name).toBe('Preview epic');

  // The discard question stays on top of the editor: the keys do not save under it.
  await epicDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('button', { name: 'Discard and close' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  expect(epic().name).toBe('Preview epic');

  // Discarding on the real server gives the epic back unchanged.
  await epicDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Discard and close' }).click();
  await expect(epicDialog).toHaveCount(0);
  await expect.poll(() => epic().isDraft).toBe(false);
  expect(epic().name).toBe('Preview epic');
  expect(agboard(mainProject, ['epic', 'edit', 'PREVIEWEP', '--name', 'Preview epic']).code).toBe(0);

  // Saving on the real server stores the change and gives the epic back.
  await page.getByRole('button', { name: 'Edit epic' }).click();
  await expect(epicDialog).toBeVisible();
  await name.fill('Preview epic, saved');
  await expect.poll(() => epic().isDraft).toBe(true);
  await epicDialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(epicDialog).toHaveCount(0);
  await expect.poll(() => epic().name).toBe('Preview epic, saved');
  expect(epic().isDraft).toBe(false);
});

test('PM-4 a task opened from the archive is read-only and never becomes a draft', async ({ page }) => {
  const id = addTask('Archived before opening');
  await archiveTask(id);
  await openBoard(page);
  await page.locator('.header__archive').click();
  await page.locator('.archive-row > button').filter({ hasText: 'Archived before opening' }).click();
  await previewButton(page).click();
  const dialog = previewOf(page, id);
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('data-read-only', '');
  await expect(dialog.getByText('Read-only because it is archived.')).toBeVisible();
  await expect(titleField(dialog)).toBeDisabled();
  await expect(saveButton(dialog)).toBeDisabled();
  expect(show(id).isDraft).toBe(false);
  await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(dialog).toHaveCount(0);
  expect(show(id).isDraft).toBe(false);
});

test('PM-4 a task archived while its preview is open turns the preview read-only', async ({ page }) => {
  const id = addTask('Archived under the dialog');
  await openBoard(page);
  const dialog = await openPreview(page, id);
  await expect(titleField(dialog)).toBeEnabled();
  await archiveTask(id);
  await expect(dialog).toHaveAttribute('data-read-only', '', { timeout: 15_000 });
  await expect(dialog.getByText('Read-only because it is archived.')).toBeVisible();
  await expect(titleField(dialog)).toBeDisabled();
  expect(show(id).isDraft).toBe(false);
});
