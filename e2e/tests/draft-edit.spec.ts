import { expect, test, type Locator, type Page } from '@playwright/test';
import { agboardOk, listCards, mainProject, nextCardId, resetBoard, type CardJson } from '../helpers/agboard';
import { editorValue, waitForSync } from '../helpers/ui';

// The whole path of a draft on the real page: make a card a draft, edit it in the dialog with the keyboard,
// save it, and hand it back. The CLI shows what was stored.

const details = (page: Page) => page.getByRole('complementary', { name: 'Card details' });
const card = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });
const selectAll = process.platform === 'darwin' ? 'Meta+a' : 'Control+a';

interface ShownCard extends CardJson {
  description: string;
  isDraft: boolean;
}

function show(id: number): ShownCard {
  return JSON.parse(agboardOk(mainProject, ['show', String(id), '--json']).stdout).card;
}

/** The names of the toolbar buttons beside the tabs, left to right. */
function toolbarLabels(page: Page): Promise<string[]> {
  return details(page)
    .getByRole('toolbar', { name: 'Card actions' })
    .getByRole('button')
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label') ?? button.textContent ?? ''));
}

let id: number;

test.beforeEach(async ({ page }) => {
  resetBoard(mainProject);
  id = nextCardId(mainProject);
  agboardOk(mainProject, ['add', 'Draft me', '--desc', '## Old section\nOld text.']);
  await page.goto('/');
  await waitForSync(page);
  await card(page, id).click();
});

async function makeDraft(page: Page): Promise<void> {
  await details(page).getByRole('button', { name: 'Make draft' }).click();
  await expect(details(page).getByRole('region', { name: 'Draft' })).toBeVisible();
  await expect.poll(() => show(id).isDraft).toBe(true);
}

async function openEditor(page: Page): Promise<{ dialog: Locator; editor: Locator; content: Locator }> {
  await details(page).getByRole('button', { name: 'Edit card' }).click();
  const dialog = page.getByRole('dialog', { name: new RegExp(`^#${id} Draft me`) });
  await expect(dialog).toBeVisible();
  const editor = dialog.getByRole('textbox', { name: 'Description (Markdown)' });
  return { dialog, editor, content: dialog.locator('.cm-content') };
}

/** Replace the whole text of the editor with keyboard input. */
async function typeIn(page: Page, editor: Locator, text: string): Promise<void> {
  await editor.click();
  await page.keyboard.press(selectAll);
  await page.keyboard.press('Delete');
  await page.keyboard.type(text);
}

test('a card becomes a draft, is edited with the keyboard, saved, and finalized in one step', async ({ page }) => {
  // Before: an ordinary card offers Make draft, not Edit.
  await expect(details(page).getByRole('button', { name: 'Edit card' })).toHaveCount(0);
  await makeDraft(page);

  // The draft is marked on the tile and in the details; Edit replaces Make draft, with Delete at the right end.
  await expect(card(page, id).getByText('Draft', { exact: true })).toHaveCount(1);
  const banner = details(page).getByRole('region', { name: 'Draft' });
  await expect(banner).toContainText('Agents can only read this card. Once you finalize it, agents can work on it.');
  expect(await toolbarLabels(page)).toEqual(['Edit card', 'Delete card']);
  await expect(details(page).getByRole('button', { name: 'Make draft' })).toHaveCount(0);

  const { dialog, editor, content } = await openEditor(page);
  await expect(dialog).toContainText('Editing draft');
  // The dialog opens with the current text, nothing changed yet, and Save disabled.
  expect(await editorValue(content)).toBe('## Old section\nOld text.');
  await expect(dialog.getByText('You have unsaved changes.')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expect(dialog.getByText('24 / 50,000')).toBeVisible();

  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill('Draft me, rewritten');
  await typeIn(page, editor, '## Plan\nFirst we plan.\n## Steps\nThen we do it.\n## Check\nLast we check.');
  expect(await editorValue(content)).toBe('## Plan\nFirst we plan.\n## Steps\nThen we do it.\n## Check\nLast we check.');
  await expect(dialog.getByText('You have unsaved changes.')).toBeVisible();

  // The outline follows the headings, and an entry takes the cursor to its heading.
  const outline = dialog.getByRole('navigation', { name: 'Outline' });
  await expect(outline.getByRole('button')).toHaveText(['Plan', 'Steps', 'Check']);
  await outline.getByRole('button', { name: 'Steps' }).click();
  await expect(content).toBeFocused();
  // The cursor sits on the line of that heading.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const node = window.getSelection()?.anchorNode;
        const element = node instanceof Element ? node : node?.parentElement;
        return element?.closest('.cm-line')?.textContent ?? null;
      }),
    )
    .toBe('## Steps');

  // Tab leaves the editor instead of being taken as an indent.
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('.cm-editor'))).toBe(false);
  expect(await editorValue(content)).toBe('## Plan\nFirst we plan.\n## Steps\nThen we do it.\n## Check\nLast we check.');

  // The preview draws the typed Markdown the way the Description tab does, with every section open to read.
  await dialog.getByRole('tab', { name: 'Preview' }).click();
  const preview = dialog.getByRole('tabpanel');
  await expect(preview.getByRole('heading', { level: 2 })).toHaveText(['Plan', 'Steps', 'Check']);
  await expect(preview.getByText('Then we do it.')).toBeVisible();
  await dialog.getByRole('tab', { name: 'Edit' }).click();

  // Nothing is stored until it is saved.
  expect(show(id).description).toBe('## Old section\nOld text.');
  await dialog.getByRole('button', { name: 'Save and finalize' }).click();
  await expect(dialog).toHaveCount(0);

  // The CLI sees the new text and a finalized card; the page shows it without the banner.
  await expect.poll(() => show(id).isDraft).toBe(false);
  expect(show(id)).toMatchObject({
    title: 'Draft me, rewritten',
    description: '## Plan\nFirst we plan.\n## Steps\nThen we do it.\n## Check\nLast we check.',
    isDraft: false,
    cardStatus: 'todo',
    agentStatus: 'idle',
  });
  await expect(details(page).getByRole('heading', { level: 2 })).toHaveText('Draft me, rewritten');
  await expect(details(page).getByRole('region', { name: 'Draft' })).toHaveCount(0);
  await expect(details(page).getByRole('button', { name: 'Make draft' })).toBeVisible();
  await expect(card(page, id).getByText('Draft', { exact: true })).toHaveCount(0);
  await expect(details(page).getByRole('tabpanel').getByRole('button', { name: 'Steps 1' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
});

test('Save keeps the card a draft, and Finalize hands it back', async ({ page }) => {
  await makeDraft(page);
  const { dialog, editor } = await openEditor(page);
  await typeIn(page, editor, 'Saved but still a draft.');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  expect(show(id)).toMatchObject({ description: 'Saved but still a draft.', isDraft: true });
  await expect(details(page).getByRole('region', { name: 'Draft' })).toBeVisible();
  await expect(details(page).getByRole('tabpanel')).toContainText('Saved but still a draft.');

  // Finalize from the banner.
  await details(page).getByRole('button', { name: 'Finalize' }).click();
  await expect(details(page).getByRole('region', { name: 'Draft' })).toHaveCount(0);
  expect(show(id).isDraft).toBe(false);
});

test('a failed save keeps the dialog and the text, and can be retried', async ({ page }) => {
  await makeDraft(page);
  let fail = true;
  let patches = 0;
  await page.route(`**/api/projects/*/cards/${id}`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    patches += 1;
    if (!fail) return route.fallback();
    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'database_error', message: 'x', reason: 'The storage is busy.' } }),
    });
  });
  const { dialog, editor, content } = await openEditor(page);
  await typeIn(page, editor, 'Typed and not lost.');
  await dialog.getByRole('button', { name: 'Save and finalize' }).click();

  // The reason the server gave is shown, with a Retry; the dialog stays.
  await expect(dialog.getByRole('alert')).toContainText('The storage is busy.');
  await expect(dialog).toBeVisible();
  expect(await editorValue(content)).toBe('Typed and not lost.');
  await expect(dialog.getByText('You have unsaved changes.')).toBeVisible();
  expect(show(id)).toMatchObject({ description: '## Old section\nOld text.', isDraft: true });

  // After a failure Save reads "Retry and save"; the alert's own Retry repeats what was attempted (finalizing).
  await expect(dialog.getByRole('button', { name: 'Retry and save' })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: 'Save and finalize' })).toBeEnabled();
  fail = false;
  await dialog.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
  await expect(dialog).toHaveCount(0);
  expect(patches).toBe(2);
  expect(show(id)).toMatchObject({ description: 'Typed and not lost.', isDraft: false });
});

test('while it saves the dialog cannot be sent twice or closed', async ({ page }) => {
  await makeDraft(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let patches = 0;
  await page.route(`**/api/projects/*/cards/${id}`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    patches += 1;
    await gate;
    return route.fallback();
  });
  const { dialog, editor } = await openEditor(page);
  await typeIn(page, editor, 'Slow save.');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Save and finalize' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.mouse.click(4, 4);
  await expect(dialog).toBeVisible();
  expect(patches).toBe(1);

  release();
  await expect(dialog).toHaveCount(0);
  expect(patches).toBe(1);
  expect(show(id).description).toBe('Slow save.');
});

test('closing with unsaved changes asks first; closing without changes does not', async ({ page }) => {
  await makeDraft(page);
  // No change: Cancel closes at once.
  let { dialog, editor, content } = await openEditor(page);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);

  // A change: Cancel, Escape, and Close all ask; Keep editing returns to the text.
  ({ dialog, editor, content } = await openEditor(page));
  await typeIn(page, editor, 'Changed text.');
  for (const close of [
    () => dialog.getByRole('button', { name: 'Cancel' }).click(),
    () => page.keyboard.press('Escape'),
    () => dialog.getByRole('button', { name: 'Close' }).click(),
  ]) {
    await close();
    const ask = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: 'Discard changes?' }));
    await expect(ask.getByText('You have unsaved changes. If you close now, what you entered will be lost.')).toBeVisible();
    await ask.getByRole('button', { name: 'Keep editing' }).click();
    await expect(ask).toHaveCount(0);
    expect(await editorValue(content)).toBe('Changed text.');
  }

  // Discard and close drops the text, and nothing was saved.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Discard and close' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(show(id)).toMatchObject({ description: '## Old section\nOld text.', isDraft: true });

  // The next time the dialog opens with the stored text.
  ({ dialog, content } = await openEditor(page));
  expect(await editorValue(content)).toBe('## Old section\nOld text.');
});

test('a description of exactly 50,000 characters saves, and one more cannot be saved', async ({ page }) => {
  await makeDraft(page);
  const { dialog, editor } = await openEditor(page);
  await editor.click();
  await page.keyboard.press(selectAll);
  await page.keyboard.press('Delete');
  // One insertion of the whole text, as a paste or an input method would deliver it.
  await page.keyboard.insertText('あ'.repeat(50_000));
  await expect(dialog.getByText('50,000 / 50,000')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save and finalize' })).toBeEnabled();

  // One character over: the count turns to the danger color, the limit is explained, and nothing can be saved.
  await page.keyboard.insertText('い');
  const counter = dialog.getByText('50,001 / 50,000');
  await expect(counter).toBeVisible();
  const color = await counter.evaluate((element) => getComputedStyle(element).color);
  const normal = await dialog.getByText('Description (Markdown)').first().evaluate((element) => getComputedStyle(element).color);
  expect(color).not.toBe(normal);
  await expect(dialog.getByText('Over the 50,000-character limit. Remove 1 character.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Save and finalize' })).toBeDisabled();
  expect(show(id).description).toBe('## Old section\nOld text.');

  await page.keyboard.press('Backspace');
  await expect(dialog.getByText('50,000 / 50,000')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save and finalize' }).click();
  await expect(dialog).toHaveCount(0);
  const stored = show(id);
  expect([...stored.description].length).toBe(50_000);
  expect(stored.description).toBe('あ'.repeat(50_000));
  expect(stored.isDraft).toBe(false);
});

test('only an idle card can be made a draft: running and pending cards have no Make draft', async ({ page }) => {
  for (const [running, name] of [[11, 'running'], [12, 'pending']] as const) {
    await card(page, running).click();
    await expect(details(page).getByRole('heading', { level: 2 })).toBeVisible();
    await expect(details(page).getByRole('button', { name: 'Make draft' }), name).toHaveCount(0);
    await expect(details(page).getByRole('button', { name: 'Edit card' }), name).toHaveCount(0);
    expect(await toolbarLabels(page)).toEqual(['Delete card']);
  }
  // An idle Doing card and a Done card can.
  for (const idle of [13, 8]) {
    await card(page, idle).click();
    await expect(details(page).getByRole('button', { name: 'Make draft' })).toBeVisible();
  }
});

test('the toolbar puts delete at the right end; its confirmation sits above the tabs and is cancelled or confirmed', async ({
  page,
}) => {
  await makeDraft(page);
  const toolbar = details(page).getByRole('toolbar', { name: 'Card actions' });
  const edit = toolbar.getByRole('button', { name: 'Edit card' });
  const del = toolbar.getByRole('button', { name: 'Delete card' });
  const editBox = (await edit.boundingBox())!;
  const delBox = (await del.boundingBox())!;
  expect(delBox.x).toBeGreaterThan(editBox.x + editBox.width - 1);
  // The right end of the toolbar is the right end of the tab row.
  const tabs = (await details(page).getByRole('tablist').boundingBox())!;
  const panel = (await details(page).boundingBox())!;
  expect(delBox.x + delBox.width).toBeLessThanOrEqual(panel.x + panel.width);
  expect(Math.abs(delBox.y + delBox.height / 2 - (tabs.y + tabs.height / 2))).toBeLessThan(tabs.height);

  await del.click();
  const ask = `Delete #${id} "Draft me"? This cannot be undone.`;
  const confirm = details(page).getByRole('group', { name: ask });
  await expect(confirm).toBeVisible();
  // The confirmation is above the tab row, which moved down to make room.
  const confirmBox = (await confirm.boundingBox())!;
  const tabsNow = (await details(page).getByRole('tablist').boundingBox())!;
  expect(confirmBox.y + confirmBox.height).toBeLessThanOrEqual(tabsNow.y + 1);
  expect(tabsNow.y).toBeGreaterThan(tabs.y);
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  expect(listCards(mainProject).map((item) => item.id)).toContain(id);

  // A failed delete says so and keeps the card; the second try works. A draft can be deleted by a person.
  let fail = true;
  await page.route(`**/api/projects/*/cards/${id}`, async (route) => {
    if (route.request().method() !== 'DELETE' || !fail) return route.fallback();
    return route.fulfill({ status: 500, body: 'no' });
  });
  await del.click();
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(confirm.getByRole('alert').or(details(page).getByRole('alert'))).toHaveText('Could not delete the card. Try again.');
  expect(listCards(mainProject).map((item) => item.id)).toContain(id);
  fail = false;
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(card(page, id)).toHaveCount(0);
  await expect(details(page)).toContainText('Select a card to see its details.');
  expect(listCards(mainProject).map((item) => item.id)).not.toContain(id);
});

test('a person can still move a draft card by dragging it', async ({ page }) => {
  await makeDraft(page);
  const source = (await card(page, id).boundingBox())!;
  const target = (await page.getByRole('region', { name: 'Doing' }).boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 24, source.y + source.height / 2, { steps: 4 });
  await page.mouse.move(target.x + 100, target.y + 100, { steps: 12 });
  await page.mouse.up();
  const move = page.getByRole('dialog');
  await expect(move).toContainText('Move card');
  await move.getByLabel('Reason').fill('The person moves the draft.');
  await move.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(move).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Doing' }).getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) })).toBeVisible();
  expect(show(id)).toMatchObject({ cardStatus: 'doing', isDraft: true });
  await expect(details(page).getByRole('region', { name: 'Draft' })).toBeVisible();
});
