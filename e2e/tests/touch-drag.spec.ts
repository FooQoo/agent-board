import { expect, test, type Page } from '../helpers/fixtures';
import { mainProject, resetBoard } from '../helpers/agboard';
import { readBoardAfterReset } from '../helpers/ui';

// A tablet held in landscape, with a finger instead of a mouse.
test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true });

test.beforeEach(async ({ page }) => {
  resetBoard(mainProject);
  await page.goto('/');
  await expect(page.getByRole('contentinfo').getByRole('status')).toHaveText(/^Synced/);
  await readBoardAfterReset(page);
});

const lane = (page: Page, name: 'Todo' | 'Doing' | 'Done') => page.getByRole('region', { name });

async function swipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  // No pause: a finger that presses and moves at once must drag from the grip.
  for (let i = 1; i <= 12; i += 1) {
    const x = from.x + ((to.x - from.x) * i) / 12;
    const y = from.y + ((to.y - from.y) * i) / 12;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('a finger on the grip drags a card to another lane at once', async ({ page }) => {
  const card = lane(page, 'Todo').getByRole('button', { name: /^#16(?!\d)/ });
  const grip = card.locator('.card__grip');
  const g = await grip.boundingBox();
  const target = await lane(page, 'Doing').boundingBox();
  if (!g || !target) throw new Error('Could not measure the grip and the lane.');
  expect(g.width).toBeGreaterThanOrEqual(30);
  expect(g.height).toBeGreaterThanOrEqual(30);

  await swipe(
    page,
    { x: g.x + g.width / 2, y: g.y + g.height / 2 },
    { x: target.x + 100, y: target.y + 100 },
  );
  // The drag reaching the other lane moves the card at once, with no dialog.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(lane(page, 'Doing').getByRole('button', { name: /^#16(?!\d)/ })).toBeVisible();
});

test('a card selects no text on a long press', async ({ page }) => {
  const card = lane(page, 'Todo').getByRole('button', { name: /^#16(?!\d)/ });
  const style = await card.evaluate((el) => {
    const s = getComputedStyle(el);
    return { select: s.userSelect, callout: s.getPropertyValue('-webkit-touch-callout') };
  });
  expect(style.select).toBe('none');
});
