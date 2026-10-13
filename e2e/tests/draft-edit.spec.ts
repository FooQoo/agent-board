import { expect, test, type Locator, type Page } from '@playwright/test';
import { agboardOk, listCards, mainProject, nextCardId, resetBoard, cardBody, type CardJson } from '../helpers/agboard';
import { editorValue, waitForSync } from '../helpers/ui';

// The whole path of a draft on the real page: make a card a draft, edit its body in the rich editor, save it, and
// hand it back. The CLI shows what was stored. A body keeps the three required headings; edits add text at its end.

const details = (page: Page) => page.getByRole('complementary', { name: 'Card details' });
const card = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });

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

/** The body the card starts with: the required headings and one line of text. */
const SEED = cardBody('## Work\n\nOld text.\n\n## Notes\n\nKept.');

let id: number;

test.beforeEach(async ({ page }) => {
  resetBoard(mainProject);
  id = nextCardId(mainProject);
  agboardOk(mainProject, ['add', 'Draft me', '--desc', SEED]);
  await page.goto('/');
  await waitForSync(page);
  await card(page, id).click();
});

async function makeDraft(page: Page): Promise<void> {
  await details(page).getByRole('button', { name: 'Make draft' }).click();
  await expect(details(page).getByRole('region', { name: 'Draft' })).toBeVisible();
  await expect.poll(() => show(id).isDraft).toBe(true);
}

async function openEditor(page: Page): Promise<{ dialog: Locator; editor: Locator }> {
  await details(page).getByRole('button', { name: 'Edit card' }).click();
  const dialog = page.getByRole('dialog', { name: new RegExp(`^#${id} Edit card`) });
  await expect(dialog).toBeVisible();
  const editor = dialog.getByRole('textbox', { name: 'Description (Markdown)' });
  // The rich editor loads its text after the dialog opens; typing before that is lost.
  await expect(editor.getByText('Old text.')).toBeVisible();
  return { dialog, editor };
}

/** Put the caret at the end of the seeded text line and type, as a person would. */
async function typeAtEnd(page: Page, editor: Locator, text: string): Promise<void> {
  await editor.getByText('Old text.').click();
  await page.keyboard.press('End');
  await page.keyboard.type(text);
}

test('a card becomes a draft, is edited and saved, and finalized from the details', async ({ page }) => {
  // Before: an ordinary card offers Make draft, not Edit.
  await expect(details(page).getByRole('button', { name: 'Edit card' })).toHaveCount(0);
  await makeDraft(page);

  // The draft is marked on the tile and in the details; Edit replaces Make draft, with Archive at the right end.
  await expect(card(page, id).getByText('Draft', { exact: true })).toHaveCount(1);
  const banner = details(page).getByRole('region', { name: 'Draft' });
  await expect(banner).toContainText('Agents can only read this card. Once you finalize it, agents can work on it.');
  expect(await toolbarLabels(page)).toEqual(['Edit card', 'Archive card']);
  await expect(details(page).getByRole('button', { name: 'Make draft' })).toHaveCount(0);

  const { dialog, editor } = await openEditor(page);
  await expect(dialog).toContainText('Edit card');
  // The dialog opens with the current text, nothing changed yet, and Save disabled.
  expect(await editorValue(editor)).toContain('## Work\n\nOld text.');
  await expect(dialog.getByText('You have unsaved changes.')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expect(dialog.getByText(`${SEED.length} / 50,000`)).toBeVisible();

  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill('Draft me, rewritten');
  await typeAtEnd(page, editor, 'Plan line.');
  expect(await editorValue(editor)).toContain('Plan line.');
  await expect(dialog.getByText('You have unsaved changes.')).toBeVisible();

  // The outline lists the three required headings, and an entry takes the caret to its heading.
  const outline = dialog.getByRole('navigation', { name: 'Outline' });
  await expect(outline.getByRole('button')).toHaveText(['01Work', '02Notes']);
  await outline.getByRole('button', { name: /Notes$/ }).click();
  await expect(editor).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const node = window.getSelection()?.anchorNode;
        const element = node instanceof Element ? node : node?.parentElement;
        return element?.closest('h2')?.textContent ?? null;
      }),
    )
    .toBe('Notes');

  // Nothing is stored until it is saved.
  expect(show(id).description).toBe(SEED);

  // Saving keeps the card a draft: the dialog has no draft box, and finalizing is done in the details.
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => show(id).description).toContain('Plan line.');
  expect(show(id)).toMatchObject({ title: 'Draft me, rewritten', isDraft: true, cardStatus: 'todo', agentStatus: 'idle' });
  expect(show(id).description).toContain('## Notes');
  await expect(details(page).getByRole('region', { name: 'Draft' })).toBeVisible();

  // Finalize from the banner: the page shows the card without the banner.
  await details(page).getByRole('button', { name: 'Finalize' }).click();
  await expect.poll(() => show(id).isDraft).toBe(false);
  await expect(details(page).getByRole('heading', { level: 2 })).toHaveText('Draft me, rewritten');
  await expect(details(page).getByRole('region', { name: 'Draft' })).toHaveCount(0);
  await expect(details(page).getByRole('button', { name: 'Make draft' })).toBeVisible();
  await expect(card(page, id).getByText('Draft', { exact: true })).toHaveCount(0);
});

test('Save keeps the card a draft, and Finalize hands it back', async ({ page }) => {
  await makeDraft(page);
  const { dialog, editor } = await openEditor(page);
  await typeAtEnd(page, editor, 'Saved but still a draft.');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  expect(show(id)).toMatchObject({ isDraft: true });
  expect(show(id).description).toContain('Saved but still a draft.');
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
  const { dialog, editor } = await openEditor(page);
  await typeAtEnd(page, editor, 'Typed and not lost.');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();

  // The design's sentence is shown, never the server's reason, with a Retry; the dialog stays.
  await expect(dialog.getByRole('alert')).toContainText('Could not save. Your input is kept. Try again.');
  await expect(dialog.getByRole('alert')).not.toContainText('The storage is busy.');
  await expect(dialog).toBeVisible();
  expect(await editorValue(editor)).toContain('Typed and not lost.');
  await expect(dialog.getByText('You have unsaved changes.')).toBeVisible();
  expect(show(id)).toMatchObject({ description: SEED, isDraft: true });

  // After a failure the primary button still reads "Save"; the alert's own Retry repeats the save.
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  fail = false;
  await dialog.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
  await expect(dialog).toHaveCount(0);
  expect(patches).toBe(2);
  expect(show(id).description).toContain('Typed and not lost.');
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
  await typeAtEnd(page, editor, 'Slow save.');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  expect(patches).toBe(1);

  release();
  await expect(dialog).toHaveCount(0);
  expect(patches).toBe(1);
  expect(show(id).description).toContain('Slow save.');
});

test('closing with unsaved changes asks first; closing without changes does not', async ({ page }) => {
  await makeDraft(page);
  // No change: Cancel closes at once.
  let { dialog, editor } = await openEditor(page);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);

  // A change: Cancel, Escape, and Close all ask; Keep editing returns to the text.
  ({ dialog, editor } = await openEditor(page));
  await typeAtEnd(page, editor, 'Changed text.');
  await expect(dialog.getByText('You have unsaved changes.')).toBeVisible();
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
    expect(await editorValue(editor)).toContain('Changed text.');
  }

  // Discard and close drops the text, and nothing was saved.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Discard and close' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(show(id)).toMatchObject({ description: SEED, isDraft: true });

  // The next time the dialog opens with the stored text.
  ({ dialog, editor } = await openEditor(page));
  expect(await editorValue(editor)).not.toContain('Changed text.');
});

test('a body of exactly 50,000 characters saves, and one more cannot be saved', async ({ page }) => {
  await makeDraft(page);
  const { dialog, editor } = await openEditor(page);
  const counter = dialog.locator('.editor__counter');
  const shown = async () => Number((await counter.textContent())!.split('/')[0].replace(/,/g, '').trim());
  await editor.getByText('Old text.').click();
  await page.keyboard.press('End');
  // One insertion of the text, as a paste or an input method would deliver it; then the rest up to the limit.
  // The counter counts the Markdown the editor writes, so the count is read rather than computed from the seed.
  await page.keyboard.insertText('あ'.repeat(40_000));
  await expect.poll(shown).toBeGreaterThan(40_000);
  await page.waitForTimeout(300);
  await page.keyboard.insertText('あ'.repeat(50_000 - (await shown())));
  await expect(dialog.locator('.editor__counter', { hasText: '50,000 / 50,000' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();

  // One character over: the count turns to the danger color, the limit is explained, and nothing can be saved.
  await page.keyboard.insertText('い');
  const over = dialog.locator('.editor__counter', { hasText: '50,001 / 50,000' });
  await expect(over).toBeVisible();
  const color = await over.evaluate((element) => getComputedStyle(element).color);
  const normal = await dialog.getByText('Description (Markdown)').first().evaluate((element) => getComputedStyle(element).color);
  expect(color).not.toBe(normal);
  await expect(dialog.getByText('Over the 50,000-character limit. Remove 1 character.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  expect(show(id).description).toBe(SEED);

  await page.keyboard.press('Backspace');
  await expect(dialog.locator('.editor__counter', { hasText: '50,000 / 50,000' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const stored = show(id);
  // The limit counts the body; the frontmatter the product writes around it is not counted.
  const storedBody = stored.description.replace(/^---\n[\s\S]*?\n---\n\n/, '');
  expect([...storedBody].length).toBeLessThanOrEqual(50_000);
  expect(stored.description).toContain('あ'.repeat(40_000));
  expect(stored.isDraft).toBe(true);
});

test('idle and Pending cards can be made drafts, while running cards cannot', async ({ page }) => {
  await card(page, 11).click();
  await expect(details(page).getByRole('heading', { level: 2 })).toBeVisible();
  await expect(details(page).getByRole('button', { name: 'Make draft' }), 'running').toHaveCount(0);
  await expect(details(page).getByRole('button', { name: 'Edit card' }), 'running').toHaveCount(0);
  expect(await toolbarLabels(page)).toEqual(['Archive card']);
  // An idle Doing card, a Pending card, and a Done card can.
  for (const idle of [13, 12, 8]) {
    await card(page, idle).click();
    await expect(details(page).getByRole('button', { name: 'Make draft' })).toBeVisible();
  }
});

test('the toolbar puts archive at the right end; its confirmation sits above the tabs and is cancelled or confirmed', async ({
  page,
}) => {
  await makeDraft(page);
  const toolbar = details(page).getByRole('toolbar', { name: 'Card actions' });
  const edit = toolbar.getByRole('button', { name: 'Edit card' });
  const archive = toolbar.getByRole('button', { name: 'Archive card' });
  const editBox = (await edit.boundingBox())!;
  const archiveBox = (await archive.boundingBox())!;
  expect(archiveBox.x).toBeGreaterThan(editBox.x + editBox.width - 1);
  // The right end of the actions is the right end of the panel header, above the tabs.
  const header = (await details(page).locator('.detail__top').boundingBox())!;
  const panel = (await details(page).boundingBox())!;
  expect(archiveBox.x + archiveBox.width).toBeLessThanOrEqual(panel.x + panel.width);
  expect(Math.abs(archiveBox.y + archiveBox.height / 2 - (header.y + header.height / 2))).toBeLessThan(header.height);
  const tabs = (await details(page).getByRole('tablist').boundingBox())!;

  await archive.click();
  const ask = `Archive #${id} "Draft me"? You can restore it from the archive.`;
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

  // A failed archive keeps the draft and confirmation; retry succeeds.
  let fail = true;
  await page.route(`**/api/projects/*/cards/${id}/archive`, async (route) => {
    if (route.request().method() !== 'POST' || !fail) return route.fallback();
    return route.fulfill({ status: 500, body: 'no' });
  });
  await archive.click();
  await confirm.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(confirm.getByRole('alert').or(details(page).getByRole('alert'))).toHaveText('Could not archive the card. Try again.');
  expect(listCards(mainProject).map((item) => item.id)).toContain(id);
  fail = false;
  await confirm.getByRole('button', { name: 'Archive', exact: true }).click();
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
