import { expect, test, type Page } from '@playwright/test';
import { resetBoard } from '../helpers/skan';

test.beforeEach(() => {
  resetBoard();
});

type Box = { x: number; y: number; width: number; height: number };

async function open(page: Page, width: number, selectId?: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('contentinfo').getByRole('status')).toHaveText(/^Synced/);
  if (selectId !== undefined) {
    await page.getByRole('button', { name: new RegExp(`^#${selectId}(?!\\d)`) }).click();
    await expect(page.getByRole('complementary', { name: 'Card details' })).toContainText(`#${selectId}`);
  }
}

async function box(locator: ReturnType<Page['locator']>): Promise<Box> {
  const found = await locator.boundingBox();
  if (!found) throw new Error('element has no box');
  return found;
}

const lanes = async (page: Page) => ({
  todo: await box(page.getByRole('region', { name: 'Todo' })),
  doing: await box(page.getByRole('region', { name: 'Doing' })),
  done: await box(page.getByRole('region', { name: 'Done' })),
});

for (const width of [1280, 800, 480]) {
  test(`${width}px: nothing scrolls sideways`, async ({ page }) => {
    for (const selectId of [undefined, 12]) {
      await open(page, width, selectId);
      const sizes = await page.evaluate(() => ({
        root: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
        body: [document.body.scrollWidth, document.body.clientWidth],
      }));
      expect(sizes.root[0]).toBeLessThanOrEqual(sizes.root[1]);
      expect(sizes.body[0]).toBeLessThanOrEqual(sizes.body[1]);
      expect(sizes.root[1]).toBe(width);
    }
  });
}

test('1280px: the panel sits at the right, 360px wide, between the header and the footer', async ({
  page,
}) => {
  for (const selectId of [undefined, 8]) {
    await open(page, 1280, selectId);
    const panel = await box(page.getByRole('complementary', { name: 'Card details' }));
    expect(panel.width).toBe(360);
    expect(panel.x).toBe(1280 - 360);

    const header = await box(page.getByRole('banner'));
    const footer = await box(page.getByRole('contentinfo'));
    expect(header.width).toBe(1280);
    expect(footer.width).toBe(1280);
    expect(panel.y).toBeCloseTo(header.y + header.height, 0);
    expect(panel.y + panel.height).toBeCloseTo(footer.y, 0);

    const { todo, doing, done } = await lanes(page);
    expect(todo.y).toBe(doing.y);
    expect(doing.y).toBe(done.y);
    expect(todo.x).toBeLessThan(doing.x);
    expect(doing.x).toBeLessThan(done.x);
    expect(done.x + done.width).toBeLessThanOrEqual(panel.x);
  }
});

test('800px: three lanes side by side with the panel below the board', async ({ page }) => {
  for (const selectId of [undefined, 8]) {
    await open(page, 800, selectId);
    const { todo, doing, done } = await lanes(page);
    expect(todo.y).toBe(doing.y);
    expect(doing.y).toBe(done.y);
    expect(todo.x).toBeLessThan(doing.x);
    expect(doing.x).toBeLessThan(done.x);
    expect(done.x + done.width).toBeLessThanOrEqual(800);

    const panel = await box(page.getByRole('complementary', { name: 'Card details' }));
    const lowest = Math.max(todo.y + todo.height, doing.y + doing.height, done.y + done.height);
    expect(panel.y).toBeGreaterThanOrEqual(lowest);
    expect(panel.x).toBe(0);
    expect(panel.width).toBe(800);

    // Each lane is as tall as its cards, so the lanes differ in height.
    expect(new Set([todo.height, doing.height, done.height]).size).toBeGreaterThan(1);
  }
});

test('480px: the lanes stack in order and the panel follows', async ({ page }) => {
  for (const selectId of [undefined, 8]) {
    await open(page, 480, selectId);
    const { todo, doing, done } = await lanes(page);
    expect(doing.y).toBeGreaterThanOrEqual(todo.y + todo.height);
    expect(done.y).toBeGreaterThanOrEqual(doing.y + doing.height);
    expect(doing.x).toBe(todo.x);
    expect(done.x).toBe(todo.x);
    expect(doing.width).toBe(todo.width);
    expect(done.width).toBe(todo.width);
    // Narrow margins: 16px around the board.
    expect(todo.x).toBe(16);
    expect(todo.x + todo.width).toBe(480 - 16);

    const panel = await box(page.getByRole('complementary', { name: 'Card details' }));
    expect(panel.y).toBeGreaterThanOrEqual(done.y + done.height);
    expect(panel.width).toBe(480);
  }
});
