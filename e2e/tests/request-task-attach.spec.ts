import { expect, test } from '../helpers/fixtures';
import type { Locator, Page } from '@playwright/test';
import { mainProject, resetBoard } from '../helpers/agboard';
import { resetPreferences } from '../helpers/preferences';
import { fillRequest, openAskAi, requestField } from '../helpers/ask-ai';
import { askItem } from '../helpers/answer';
import { waitForSync } from '../helpers/ui';

// The "Attach task" button of the Ask AI composer: a popover on the board, a second sheet on a phone.
// The request text is the only state, so every step is checked through the text field.

const TEXT = 'Fix the sign-in message';

test.afterEach(() => resetPreferences());

test.beforeEach(async () => {
  resetBoard(mainProject);
  await resetPreferences();
});

const attachButton = (composer: Locator) => composer.getByRole('button', { name: /^Attach task/ });
const picker = (page: Page) => page.getByRole('dialog', { name: 'Attach tasks' });
const box = (page: Page, id: number) => picker(page).getByRole('checkbox', { name: new RegExp(`#${id}(?!\\d)`) });

async function checkFlow(page: Page, composer: Locator) {
  const field = requestField(composer);
  await fillRequest(composer, TEXT);
  await expect(attachButton(composer)).toHaveText('Attach task');

  // Search by number, then pick two tasks and confirm: the ids become the last line.
  await attachButton(composer).click();
  await expect(picker(page)).toBeVisible();
  const search = picker(page).getByRole('searchbox', { name: /Search tasks/ });
  await search.fill('12');
  await expect(picker(page).getByRole('checkbox')).toHaveCount(1);
  await search.fill('');
  await box(page, 11).check();
  await box(page, 12).check();
  await picker(page).getByRole('button', { name: 'Attach (2)' }).click();
  await expect(picker(page)).toBeHidden();
  await expect(field).toHaveValue(`${TEXT}\n#11 #12`);
  await expect(attachButton(composer)).toHaveText('Attach task (2)');
  await expect(attachButton(composer)).toBeFocused();

  // Reopening shows the ids of the last line as checked; confirming replaces the line.
  await attachButton(composer).click();
  await expect(box(page, 11)).toBeChecked();
  await expect(box(page, 12)).toBeChecked();
  await expect(box(page, 13)).not.toBeChecked();
  await box(page, 11).uncheck();
  await box(page, 13).check();
  await picker(page).getByRole('button', { name: 'Attach (2)' }).click();
  await expect(field).toHaveValue(`${TEXT}\n#12 #13`);

  // A manual edit of the line shows up the next time the picker opens.
  await field.fill(`${TEXT}\n#14`);
  await attachButton(composer).click();
  await expect(box(page, 14)).toBeChecked();
  await expect(box(page, 12)).not.toBeChecked();
  await box(page, 14).uncheck();
  await picker(page).getByRole('button', { name: 'Attach (0)' }).click();
  await expect(field).toHaveValue(TEXT);
  await expect(attachButton(composer)).toHaveText('Attach task');

  // A task number in the middle of the text is not an attachment line.
  await field.fill(`About #12 only\n${TEXT}`);
  await expect(attachButton(composer)).toHaveText('Attach task');
  await field.fill(TEXT);
}

async function checkKeyboard(page: Page, composer: Locator) {
  const field = requestField(composer);
  await fillRequest(composer, TEXT);
  await attachButton(composer).focus();
  await page.keyboard.press('Enter');
  await expect(picker(page)).toBeVisible();
  const search = picker(page).getByRole('searchbox', { name: /Search tasks/ });
  // A sheet keeps its own body focused when it opens; the popover goes straight to the search field.
  if (!(await search.evaluate((element) => element === document.activeElement))) await page.keyboard.press('Tab');
  await expect(search).toBeFocused();
  await page.keyboard.type('11');
  await page.keyboard.press('Tab');
  await expect(box(page, 11)).toBeFocused();
  await page.keyboard.press('Space');
  await expect(box(page, 11)).toBeChecked();
  await page.keyboard.press('Tab');
  await expect(picker(page).getByRole('button', { name: 'Attach (1)' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(field).toHaveValue(`${TEXT}\n#11`);
  await expect(attachButton(composer)).toBeFocused();

  // Escape closes the picker only; the composer stays and the button has the focus again.
  await page.keyboard.press('Enter');
  await expect(picker(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker(page)).toBeHidden();
  await expect(composer).toBeVisible();
  await expect(attachButton(composer)).toBeFocused();
  await expect(field).toHaveValue(`${TEXT}\n#11`);

  // Sending right after the picker closed works.
  await composer.getByRole('button', { name: 'Send request' }).click();
  await expect(composer).toBeHidden();
}

test.describe('on the board', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForSync(page);
  });

  test('the picker is a popover above the button and writes the last line', async ({ page }) => {
    const composer = await openAskAi(page);
    await checkFlow(page, composer);
    const button = await attachButton(composer).boundingBox();
    await attachButton(composer).click();
    const popover = await picker(page).boundingBox();
    if (!button || !popover) throw new Error('The picker did not render.');
    expect(popover.y + popover.height).toBeLessThanOrEqual(button.y + 1);
  });

  test('the keyboard reaches the button, search, rows and confirm', async ({ page }) => {
    const composer = await openAskAi(page);
    await checkKeyboard(page, composer);
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(askItem(page)).toBeVisible();
  });

  const open = async (page: Page) => {
    await askItem(page).click();
    const composer = page.getByRole('dialog', { name: 'Ask AI' });
    await expect(composer).toBeVisible();
    return composer;
  };

  test('the picker is a sheet over the composer and writes the last line', async ({ page }) => {
    const composer = await open(page);
    await checkFlow(page, composer);
    await attachButton(composer).tap();
    await expect(picker(page)).toBeVisible();
    // The sheet slides in; once it has settled it fits the screen.
    await expect
      .poll(async () => {
        const sheet = await picker(page).boundingBox();
        return sheet ? sheet.x + sheet.width <= 391 && sheet.y + sheet.height <= 845 : false;
      })
      .toBe(true);
  });

  test('the keyboard reaches the button, search, rows and confirm', async ({ page }) => {
    const composer = await open(page);
    await checkKeyboard(page, composer);
  });
});
