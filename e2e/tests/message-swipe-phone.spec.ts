import { expect, test } from '../helpers/fixtures';
import { mainProject, resetBoard } from '../helpers/agboard';
import { openMessageList } from '../helpers/answer';

// An iPhone-sized touch screen with no message at all.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test.beforeEach(async () => {
  resetBoard(mainProject);
});

test('a finger swipe low in an empty Messages sheet switches the tabs', async ({ page }) => {
  await page.goto('/');
  const sheet = await openMessageList(page);
  const [fromAi, fromYou] = await sheet.getByRole('tab').all();
  await expect(fromAi).toHaveAttribute('aria-selected', 'true');
  const empty = sheet.locator('.message-list__empty').first();
  await expect(empty).toBeVisible();
  const viewport = sheet.locator('.message-list__viewport');
  // The sheet slides up first: measure once it has stopped.
  let last = -1;
  await expect
    .poll(async () => {
      const y = (await viewport.boundingBox())?.y ?? -1;
      const settled = y === last;
      last = y;
      return settled;
    })
    .toBe(true);
  const text = await empty.boundingBox();
  const box = await viewport.boundingBox();
  if (!text || !box) throw new Error('The sheet did not render.');
  // Well below the one-line message.
  const y = box.y + box.height - 40;
  expect(y).toBeGreaterThan(text.y + text.height + 100);

  const cdp = await page.context().newCDPSession(page);
  const swipe = async (from: number, to: number) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from, y }] });
    for (let i = 1; i <= 10; i += 1) {
      const x = from + ((to - from) * i) / 10;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await swipe(box.x + box.width - 20, box.x + 20);
  await expect(fromYou).toHaveAttribute('aria-selected', 'true');
  await swipe(box.x + 20, box.x + box.width - 20);
  await expect(fromAi).toHaveAttribute('aria-selected', 'true');
});
