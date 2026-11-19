import { expect, test, type Locator, type Page } from '../helpers/fixtures';
import { mainProject, resetBoard } from '../helpers/agboard';
import { openMessageList } from '../helpers/answer';

// An iPad held sideways: a touch screen wide enough for the PC board, so Messages is a modal and
// the task details sit in the side panel.
test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true });

test.beforeEach(async () => {
  resetBoard(mainProject);
});

/** Waits until the element stops moving (a modal fades and scales in) and returns its box. */
async function settledBox(target: Locator) {
  let last = '';
  await expect
    .poll(async () => {
      const now = JSON.stringify(await target.boundingBox());
      const settled = now === last;
      last = now;
      return settled;
    })
    .toBe(true);
  const box = await target.boundingBox();
  if (!box) throw new Error('The element did not render.');
  return box;
}

/** Drags one finger sideways along the line y. */
async function swipe(page: Page, y: number, from: number, to: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from, y }] });
  for (let i = 1; i <= 10; i += 1) {
    const x = from + ((to - from) * i) / 10;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('a finger swipe anywhere in the Messages modal body switches the tabs', async ({ page }) => {
  await page.goto('/');
  const modal = await openMessageList(page);
  const [fromAi, fromYou] = await modal.getByRole('tab').all();
  await expect(fromAi).toHaveAttribute('aria-selected', 'true');
  const box = await settledBox(modal.locator('.message-list__viewport'));
  // Low in the body, well below the rows: the whole body is the swipe area.
  const body = await modal.locator('.surface__body').boundingBox();
  if (!body) throw new Error('The modal has no body.');
  expect(box.y + box.height).toBeGreaterThanOrEqual(body.y + body.height - 2);
  const y = box.y + box.height - 30;
  await swipe(page, y, box.x + box.width - 40, box.x + 40);
  await expect(fromYou).toHaveAttribute('aria-selected', 'true');
  await swipe(page, y, box.x + 40, box.x + box.width - 40);
  await expect(fromAi).toHaveAttribute('aria-selected', 'true');
});

test('a finger swipe on the task details slides to the next tab and back', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^#13(?!\d)/ }).click();
  const panel = page.getByRole('complementary', { name: 'Task details' });
  const description = panel.getByRole('tab', { name: 'Description' });
  await expect(description).toHaveAttribute('aria-selected', 'true');
  const box = await settledBox(panel.locator('.detail__pages'));
  const y = box.y + box.height / 2;
  await swipe(page, y, box.x + box.width - 30, box.x + 30);
  await expect(description).toHaveAttribute('aria-selected', 'false');
  await expect(panel.getByRole('tabpanel')).toHaveCount(1);
  await swipe(page, y, box.x + 30, box.x + box.width - 30);
  await expect(description).toHaveAttribute('aria-selected', 'true');
  await expect(panel.getByRole('tabpanel')).toContainText('Check the layout at 1280, 800, and 480 px.');
});
