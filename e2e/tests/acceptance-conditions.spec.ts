import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  agboard,
  agboardOk,
  mainProject,
  nextCardId,
  projectId,
  replaceFileAtomically,
  resetBoard,
  workspace,
  type CardJson,
} from '../helpers/agboard';
import { editorValue, waitForSync } from '../helpers/ui';

// The acceptance conditions on the real page and in the real CLI: how they show on the board and in the details,
// how a person adds, edits, reorders, and checks them, what a broken frontmatter does, and when an agent may not
// move a card to Done.

interface Condition {
  id: string;
  text: string;
  done: boolean;
}

interface Shown extends CardJson {
  description: string;
  isDraft: boolean;
  acceptance: Condition[];
  acceptanceError: boolean;
}

const details = (page: Page) => page.getByRole('complementary', { name: 'Card details' });
const card = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });

function show(id: number): Shown {
  return JSON.parse(agboardOk(mainProject, ['show', String(id), '--json']).stdout).card;
}

/** The TASK.md file of a card in the shared folder. */
function taskFile(id: number): string {
  return path.join(workspace(mainProject).folder, 'tasks', String(id), 'TASK.md');
}

/** A card the CLI writes with the given frontmatter and body; returns its ID. */
function addCard(title: string, description: string): number {
  const id = nextCardId(mainProject);
  agboardOk(mainProject, ['add', title, '--desc', description]);
  return id;
}

/** The frontmatter and body of a card with the given conditions, written the way an agent writes them. */
function frontmatter(conditions: Condition[], body = 'Body text.'): string {
  const items = conditions
    .map((c) => `  - id: ${c.id}\n    text: ${c.text}\n    done: ${c.done}`)
    .join('\n');
  return `---\nacceptance:\n${items}\n---\n\n${body}\n`;
}

const THREE: Condition[] = [
  { id: 'AC-1', text: 'The list is returned as JSON', done: false },
  { id: 'AC-2', text: 'Deletion asks for confirmation', done: false },
  { id: 'AC-3', text: 'The page is readable on a phone', done: false },
];

/** Make a card a draft so that a person can edit it on the page. */
async function makeDraft(page: Page, id: number): Promise<void> {
  await card(page, id).click();
  await details(page).getByRole('button', { name: 'Make draft' }).click();
  await expect.poll(() => show(id).isDraft).toBe(true);
}

/** Open the card's edit dialog and wait until its text has loaded. */
async function openEdit(page: Page, id: number): Promise<{ dialog: Locator; editor: Locator }> {
  await card(page, id).click();
  await details(page).getByRole('button', { name: 'Edit card' }).click();
  const dialog = page.getByRole('dialog', { name: new RegExp(`^#${id} Edit card`) });
  await expect(dialog).toBeVisible();
  const editor = dialog.getByRole('textbox', { name: 'Description (Markdown)' });
  await expect(editor.getByText(/./).first()).toBeVisible();
  return { dialog, editor };
}

test.beforeEach(async ({ page }) => {
  resetBoard(mainProject);
  await page.goto('/');
  await waitForSync(page);
});

test('the board and the details show the number of conditions done, and nothing for a card without conditions', async ({ page }) => {
  const none = addCard('No conditions', frontmatter([], 'Only a body.'));
  const partial = addCard(
    'Partly done',
    frontmatter([
      { id: 'AC-1', text: 'First', done: true },
      { id: 'AC-2', text: 'Second', done: false },
    ]),
  );
  const complete = addCard(
    'All done',
    frontmatter([
      { id: 'AC-1', text: 'First', done: true },
      { id: 'AC-2', text: 'Second', done: true },
    ]),
  );
  await page.reload();
  await waitForSync(page);

  await expect(card(page, none).locator('.acceptance-chip')).toHaveCount(0);
  const partialChip = card(page, partial).locator('.acceptance-chip');
  await expect(partialChip).toHaveAttribute('title', 'Acceptance conditions 1 / 2');
  await expect(partialChip).toHaveText('1/2');
  await expect(partialChip).not.toHaveAttribute('data-complete', 'true');
  await expect(card(page, complete).locator('.acceptance-chip')).toHaveAttribute('data-complete', 'true');

  // Conditions have their own tab; neither document holds a bottom dock.
  await card(page, partial).click();
  await details(page).getByRole('tab', { name: 'Conditions', exact: true }).click();
  await expect(details(page).getByRole('tabpanel')).toContainText('1 / 2');
  await expect(details(page).getByText('First', { exact: true })).toBeVisible();
  await expect(details(page).getByText('Second', { exact: true })).toBeVisible();
});

test('a person adds conditions when creating a card, and the CLI reads them back with the same ids and text', async ({ page }) => {
  const id = nextCardId(mainProject);
  await page.getByRole('button', { name: 'Add card' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add card' });
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill('Plan the list endpoint');
  await dialog.getByRole('button', { name: /^Acceptance conditions/ }).click();
  for (const [index, condition] of THREE.entries()) {
    await dialog.getByRole('button', { name: 'Add condition' }).click();
    await dialog.getByRole('textbox', { name: `Condition AC-${index + 1}` }).fill(condition.text);
  }
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  expect(show(id).acceptance).toEqual(THREE);
});

test('the focus ring of the first condition is not cut off by the scrolling list', async ({ page }) => {
  await page.getByRole('button', { name: 'Add card' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add card' });
  await dialog.getByRole('button', { name: /^Acceptance conditions/ }).click();
  await dialog.getByRole('button', { name: 'Add condition' }).click();
  const first = dialog.getByRole('textbox', { name: 'Condition AC-1' });
  await first.focus();
  // The list scrolls and clips what is outside its box, so the ring (outline width plus offset) must fit above the row.
  const { room, ring } = await first.evaluate((input) => {
    const list = input.closest('.conditions-dock__body');
    if (!list) throw new Error('the condition is not inside the scrolling list');
    const style = getComputedStyle(input);
    return {
      room: input.getBoundingClientRect().top - list.getBoundingClientRect().top,
      ring: parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset),
    };
  });
  expect(ring).toBeGreaterThan(0);
  expect(room).toBeGreaterThanOrEqual(ring);
});

test('a person edits the conditions of a draft: removes, adds without reusing a number, checks, and saves them together with the body', async ({ page }) => {
  const id = addCard('Edit me', frontmatter(THREE, 'Old text.'));
  await page.reload();
  await waitForSync(page);
  await makeDraft(page, id);

  const { dialog } = await openEdit(page, id);
  await dialog.getByRole('button', { name: /^Acceptance conditions/ }).click();
  await dialog.getByRole('button', { name: 'Remove AC-2' }).click();
  await dialog.getByRole('button', { name: 'Add condition' }).click();
  await dialog.getByRole('textbox', { name: 'Condition AC-4' }).fill('The fourth condition');
  await dialog.getByRole('checkbox', { name: 'Done: AC-1' }).check();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  // Nothing of the edit is read by the CLI until Save; after Save the conditions are in the order shown.
  expect(show(id).acceptance).toEqual([
    { id: 'AC-1', text: THREE[0].text, done: true },
    { id: 'AC-3', text: THREE[2].text, done: false },
    { id: 'AC-4', text: 'The fourth condition', done: false },
  ]);
  expect(show(id).description).toContain('Old text.');
});

test('cancelling the edit dialog discards the changes to the conditions', async ({ page }) => {
  const id = addCard('Cancel me', frontmatter(THREE));
  await page.reload();
  await waitForSync(page);
  await makeDraft(page, id);

  const { dialog } = await openEdit(page, id);
  await dialog.getByRole('button', { name: /^Acceptance conditions/ }).click();
  await dialog.getByRole('button', { name: 'Remove AC-1' }).click();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(show(id).acceptance).toEqual(THREE);
});

test('a save of the body keeps the other frontmatter keys, which the page does not show', async ({ page }) => {
  const id = addCard('Keep my keys', '---\ntags:\n  - plan\nacceptance: []\n---\n\nold\n');
  await page.reload();
  await waitForSync(page);
  await makeDraft(page, id);

  const { dialog, editor } = await openEdit(page, id);
  await editor.getByText('old').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' more');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const text = readFileSync(taskFile(id), 'utf8');
  expect(text).toContain('tags:');
  expect(text).toContain('old more');
  expect(show(id).acceptance).toEqual([]);
});

test('a frontmatter that cannot be read is shown as a problem, the body stays visible, and the card reads unreadable until the file is fixed', async ({ page }) => {
  const id = addCard('Broken', frontmatter(THREE, 'Body stays visible.'));
  const original = readFileSync(taskFile(id), 'utf8');
  const broken = original.replace('done: false', 'done: maybe');
  writeFileSync(taskFile(id), broken, 'utf8');
  await page.reload();
  await waitForSync(page);

  await card(page, id).click();
  await expect(details(page).getByText('Body stays visible.')).toBeVisible();
  await expect(details(page).locator('.acceptance-unreadable')).toContainText('tasks/' + id + '/TASK.md');
  await expect(card(page, id).locator('.acceptance-chip--error')).toHaveText('Unreadable');

  // The product does not rewrite the file; the CLI reports the same problem.
  expect(readFileSync(taskFile(id), 'utf8')).toBe(broken);
  const snapshot = JSON.parse(agboardOk(mainProject, ['snapshot', '--json']).stdout);
  expect(snapshot.problems).toEqual(
    expect.arrayContaining([expect.objectContaining({ file: expect.stringContaining(`tasks/${id}/TASK.md`) })]),
  );

  // Fixing the file brings the progress back.
  replaceFileAtomically(taskFile(id), original);
  await page.reload();
  await waitForSync(page);
  await expect(card(page, id).locator('.acceptance-chip')).toHaveAttribute('title', 'Acceptance conditions 0 / 3');
});

test('an agent cannot move a card to Done while a condition is unmet, and a person can', async ({ page }) => {
  const id = addCard('Unmet', frontmatter([{ id: 'AC-1', text: 'Still open', done: false }]));
  const refused = agboard(mainProject, ['mv', String(id), 'done', '--actor', 'ai', '--reason', 'Finished.']);
  expect(refused.code).toBe(2);
  expect(refused.stderr).toContain('unmet acceptance conditions: AC-1');
  expect(show(id).cardStatus).toBe('todo');

  // A person moves the card from the page, with the conditions still unmet.
  await page.reload();
  await waitForSync(page);
  const pid = projectId(mainProject);
  const moved = await page.evaluate(
    async ({ url, body }) => {
      const meta = document.querySelector('meta[name="agboard-token"]')?.getAttribute('content') ?? '';
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Agboard-Token': meta },
        body: JSON.stringify(body),
      });
      return response.status;
    },
    { url: `/api/projects/${pid}/cards/${id}/move`, body: { cardStatus: 'done', reason: 'Dropped the condition.' } },
  );
  expect(moved).toBe(200);
  expect(show(id).cardStatus).toBe('done');
});

test('a card written in the earlier Japanese form is read as a body with no conditions and no problem', async ({ page }) => {
  const id = addCard(
    'Old form',
    '## 作業内容\n\n作業。\n\n## 完了条件と確認結果\n\n- [ ] AC-1. 旧形式\n\n## 実行記録\n\n',
  );
  await page.reload();
  await waitForSync(page);

  await card(page, id).click();
  await expect(details(page).getByText('作業。')).toBeVisible();
  await expect(card(page, id).locator('.acceptance-chip')).toHaveCount(0);
  await expect(details(page).getByRole('alert')).toHaveCount(0);
  expect(show(id)).toMatchObject({ acceptance: [], acceptanceError: false });
});

test('the edit dialog wraps each condition onto two rows in a narrow width and keeps one row on a desktop width', async ({ page }) => {
  const id = addCard('Narrow', frontmatter(THREE));
  await page.reload();
  await waitForSync(page);
  await makeDraft(page, id);

  // The dialog is open at the desktop width; the gap is measured between the first condition's checkbox and text.
  const { dialog } = await openEdit(page, id);
  await dialog.getByRole('button', { name: /^Acceptance conditions/ }).click();
  const rowGap = async () => {
    const done = await dialog.getByRole('checkbox', { name: 'Done: AC-1' }).boundingBox();
    const text = await dialog.getByRole('textbox', { name: 'Condition AC-1' }).boundingBox();
    if (!done || !text) throw new Error('condition row has no box');
    return text.y - done.y;
  };

  // On a desktop the control and the text share a row (the text is a little lower than the checkbox); on a phone the
  // text moves to a second row, well below the checkbox.
  expect(Math.abs(await rowGap())).toBeLessThan(20);
  await page.setViewportSize({ width: 400, height: 800 });
  await expect.poll(rowGap).toBeGreaterThan(20);
});

test('epic reference conditions stay in the Markdown body without a conditions dock', async ({ page }) => {
  const plan = path.join(os.tmpdir(), `epic-plan-${Date.now()}.md`);
  agboardOk(mainProject, ['epic', 'add', 'PLAN-CHK', '--name', 'Checked plan', '--color', '#7C3AED', '--actor', 'human']);
  const text = '## Goal\n\nGoal.\n\n## Reference conditions\n\n- [x] Planned\n- [ ] Open\n';
  replaceFileAtomically(plan, text);
  agboardOk(mainProject, ['epic', 'edit', 'PLAN-CHK', '--plan-file', plan]);
  const stored = JSON.parse(agboardOk(mainProject, ['epic', 'show', 'PLAN-CHK', '--json']).stdout).epic;
  expect(stored).not.toHaveProperty('acceptance');
  expect(stored.body).toBe(text.trimEnd());
  const inPlan = addCard('In the checked plan', frontmatter([], 'Work for the plan.'));
  agboardOk(mainProject, ['edit', String(inPlan), '--epic', 'PLAN-CHK']);
  await page.reload();
  await waitForSync(page);
  await page.locator('[data-epic-label="PLAN-CHK"]').first().click();
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('textbox', { name: 'Formal name' }) });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.conditions-dock')).toHaveCount(0);
  expect(await editorValue(dialog.getByRole('textbox', { name: 'Plan (Markdown)' }))).toContain('Planned');
});

test('task conditions fold in their own dock and a long body scrolls alone', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  const conditions = Array.from({ length: 40 }, (_, index) => ({
    id: `AC-${index + 1}`,
    text: `Condition number ${index + 1}`,
    done: false,
  }));
  const body = `## Body starts here\n\n${Array.from({ length: 30 }, (_, index) => `Paragraph ${index + 1}.`).join('\n\n')}\n\nBody ends here.`;
  const id = addCard('Many conditions', frontmatter(conditions, body));
  await page.reload();
  await waitForSync(page);

  await makeDraft(page, id);
  const { dialog } = await openEdit(page, id);

  // The conditions are not in the body: they fold in the dock at the bottom of the dialog.
  const scroll = dialog.locator('.editor__document');
  const dock = dialog.locator('.editor__dock');
  const dockHead = dock.getByRole('button', { name: /^Acceptance conditions/ });
  await expect(dockHead).toBeVisible();
  await expect(scroll.getByRole('textbox', { name: 'Condition AC-1', exact: true })).toHaveCount(0);
  const title = dialog.getByRole('textbox', { name: 'Title', exact: true });
  const titleBox = await title.boundingBox();
  await scroll.hover();
  await page.mouse.wheel(0, 700);
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect((await title.boundingBox())?.y).toBe(titleBox?.y);

  // Opened, the conditions scroll inside the dock, and the body keeps its own position.
  const before = await scroll.evaluate((element) => element.scrollTop);
  await dockHead.click();
  await expect(dock.getByRole('textbox', { name: 'Condition AC-1', exact: true })).toBeVisible();
  const conditionList = dock.locator('.conditions-dock__body');
  await conditionList.hover();
  await page.mouse.wheel(0, 400);
  await expect.poll(() => conditionList.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await scroll.evaluate((element) => element.scrollTop)).toBe(before);
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeInViewport();
  });
