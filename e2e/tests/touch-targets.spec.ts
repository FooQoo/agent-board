import { expect, test, type Locator, type Page } from '../helpers/fixtures';
import { mainProject, resetBoard } from '../helpers/agboard';
import { readBoardAfterReset } from '../helpers/ui';
import { answerButton, openListButton } from '../helpers/answer';
import { openAskAi } from '../helpers/ask-ai';

// An iPad held upright: the desktop layout, a finger as the pointer, and the detail panel open.
test.use({ viewport: { width: 834, height: 1194 }, hasTouch: true, isMobile: true });

test.beforeEach(async ({ page }) => {
  resetBoard(mainProject);
  await page.goto('/');
  await expect(page.getByRole('contentinfo').getByRole('status')).toHaveText(/^Synced/);
  await readBoardAfterReset(page);
});

/** A finger needs 44px: the box of the control is at least that high and wide (a dialog may still be zooming in). */
async function expectFingerSized(locator: Locator, label: string) {
  await expect
    .poll(async () => {
      const box = await locator.boundingBox();
      return box ? Math.min(box.width, box.height) : 0;
    }, { message: `${label} is at least 44px` })
    .toBeGreaterThanOrEqual(43.5);
}

const openCard = async (page: Page, id: number) => {
  await page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) }).first().click();
  await expect(page.locator('.detail__close')).toBeVisible();
};

test('opening the Ask AI dialog leaves the software keyboard down', async ({ page }) => {
  const dialog = await openAskAi(page);
  await expect.poll(() => dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  const focused = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return {
      tag: active?.tagName,
      editable: active?.isContentEditable === true,
    };
  });
  expect(['INPUT', 'TEXTAREA']).not.toContain(focused.tag);
  expect(focused.editable).toBe(false);
});

test('the header, the band, the detail panel and the dialogs have finger-sized controls', async ({
  page,
}) => {
  const header = page.getByRole('banner');
  await expectFingerSized(header.getByRole('button', { name: 'Ask AI' }), 'Ask AI');
  await expectFingerSized(header.getByRole('button', { name: 'Settings' }), 'Settings');
  await expectFingerSized(header.locator('.project-switcher'), 'project switcher');
  expect((await header.boundingBox())?.height).toBe(56);

  await expectFingerSized(openListButton(page), 'Check questions and requests');

  await openCard(page, 16);
  await expectFingerSized(page.locator('.detail__close'), 'detail close');
  await expectFingerSized(page.locator('.detail__tool').first(), 'detail tool');
  for (const tab of await page.locator('.detail__tab').all()) {
    expect((await tab.boundingBox())?.height).toBeGreaterThanOrEqual(43.5);
  }

  await header.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expectFingerSized(settings.locator('.modal__close'), 'modal close');
  for (const tile of await settings.getByRole('radio').all()) {
    await expectFingerSized(tile, 'theme tile');
  }
});

test('a pending card keeps its badge and its answer button whole beside the open panel', async ({
  page,
}) => {
  await openCard(page, 16);
  const pending = page.locator('.card--pending').first();
  await expect(pending).toBeVisible();
  const badge = pending.locator('.status-label');
  await expect(badge).toHaveText(/Pending/);
  expect(await badge.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const button = answerButton(page, 12);
  await expect(button).toBeVisible();
  expect(await button.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await button.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
});
