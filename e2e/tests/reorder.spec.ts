import { expect, test, type Locator, type Page } from '@playwright/test';
import { mainProject, resetBoard } from '../helpers/agboard';

// The seed is the eight sample cards; see fixtures/agent-board.json.
test.beforeEach(async ({ page }) => {
  resetBoard(mainProject);
  await page.goto('/');
  await expect(page.getByRole('contentinfo').getByRole('status')).toHaveText(/^Synced/);
  await expect(page.locator('.card').first()).toBeVisible();
});

const lane = (page: Page, name: 'Todo' | 'Doing' | 'Done'): Locator =>
  page.getByRole('region', { name });

const ids = (page: Page, name: 'Todo' | 'Doing' | 'Done') =>
  lane(page, name)
    .locator('.card__id')
    .allTextContents();

async function dragOnto(page: Page, from: Locator, to: Locator, below: boolean) {
  const source = await from.boundingBox();
  const target = await to.boundingBox();
  if (!source || !target) throw new Error('Could not measure the drag source and target.');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 16, source.y + source.height / 2 + 8, {
    steps: 4,
  });
  await page.mouse.move(
    target.x + target.width / 2,
    target.y + (below ? target.height * 0.75 : target.height * 0.25),
    { steps: 12 },
  );
  await page.mouse.up();
}

test('dragging a card above another in its lane reorders it and keeps the order after a reload', async ({
  page,
}) => {
  const before = await ids(page, 'Todo');
  expect(before.length).toBeGreaterThan(1);
  const cards = lane(page, 'Todo').locator('.card__item');
  await dragOnto(page, cards.last(), cards.first(), false);
  const expected = [before[before.length - 1], ...before.slice(0, -1)];
  await expect.poll(() => ids(page, 'Todo')).toEqual(expected);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // The cards keep the lane's gap after the drop.
  await expect
    .poll(() =>
      cards.evaluateAll((nodes) =>
        nodes.slice(1).map((node, i) =>
          Math.round(node.getBoundingClientRect().top - nodes[i].getBoundingClientRect().bottom),
        ),
      ),
    )
    .toEqual(Array(before.length - 1).fill(10));
  await page.reload();
  await expect.poll(() => ids(page, 'Todo')).toEqual(expected);
});

test('dragging a card to the bottom of its lane reorders it', async ({ page }) => {
  const before = await ids(page, 'Todo');
  const cards = lane(page, 'Todo').locator('.card__item');
  await dragOnto(page, cards.first(), cards.last(), true);
  const expected = [...before.slice(1), before[0]];
  await expect.poll(() => ids(page, 'Todo')).toEqual(expected);
});

test('the Done lane reorders in the order it shows', async ({ page }) => {
  const before = await ids(page, 'Done');
  const cards = lane(page, 'Done').locator('.card__item');
  await dragOnto(page, cards.last(), cards.first(), false);
  const expected = [before[before.length - 1], ...before.slice(0, -1)];
  await expect.poll(() => ids(page, 'Done')).toEqual(expected);
  await page.reload();
  await expect.poll(() => ids(page, 'Done')).toEqual(expected);
});

test('dropping a card on another lane still asks for a reason and does not reorder', async ({
  page,
}) => {
  const todo = await ids(page, 'Todo');
  const source = lane(page, 'Todo').locator('.card').first();
  const target = lane(page, 'Doing').locator('.card').first();
  await dragOnto(page, source, target, false);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect.poll(() => ids(page, 'Todo')).toEqual(todo);
});
