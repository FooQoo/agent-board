import { expect, test, type Page } from '@playwright/test';
import { resetBoard, mainProject } from '../helpers/agboard';

// There is one desktop layout. These checks run it at the supported desktop widths.
test.beforeEach(() => {
  resetBoard(mainProject);
});

type Box = { x: number; y: number; width: number; height: number };

async function open(page: Page, width: number, selectId?: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('contentinfo').getByRole('status')).toHaveText(/^Synced/);
  if (selectId !== undefined) {
    await page.getByRole('button', { name: new RegExp(`^#${selectId}(?!\\d)`) }).click();
    await expect(page.getByRole('complementary', { name: 'Task details' })).toContainText(`#${selectId}`);
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

for (const width of [1024, 1280, 1920]) {
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

  test(`${width}px: three lanes, the panel at the right between the header and the footer`, async ({ page }) => {
    for (const selectId of [undefined, 8]) {
      await open(page, width, selectId);
      const panel = await box(page.getByRole('complementary', { name: 'Task details' }));
      expect(panel.x + panel.width).toBe(width);
      expect(panel.width).toBe(width === 1024 ? 344 : 360);

      const header = await box(page.getByRole('banner'));
      const footer = await box(page.getByRole('contentinfo'));
      expect(header.width).toBe(width);
      expect(footer.width).toBe(width);
      expect(panel.y).toBeCloseTo(header.y + header.height, 0);
      expect(panel.y + panel.height).toBeCloseTo(footer.y, 0);

      const { todo, doing, done } = await lanes(page);
      expect(todo.y).toBe(doing.y);
      expect(doing.y).toBe(done.y);
      expect(todo.x).toBeLessThan(doing.x);
      expect(doing.x).toBeLessThan(done.x);
      expect(done.x + done.width).toBeLessThanOrEqual(panel.x);
      // The lanes are as tall as the area between the header and the footer.
      expect(new Set([todo.height, doing.height, done.height]).size).toBe(1);
    }
  });
}
