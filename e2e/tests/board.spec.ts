import { expect, test, type Locator } from '@playwright/test';
import { resetBoard } from '../helpers/agboard';

// The seed is the eight cards of the approved mock; see fixtures/agent-board.json.
test.beforeEach(async ({ page }) => {
  resetBoard();
  await page.goto('/');
  await expect(page.getByRole('contentinfo').getByRole('status')).toHaveText(/^Synced/);
});

function lane(page: import('@playwright/test').Page, name: 'Todo' | 'Doing' | 'Done'): Locator {
  return page.getByRole('region', { name });
}

test('the header and the page title show the board name', async ({ page }) => {
  await expect(page).toHaveTitle('agent-board - Agent Board');
  const header = page.getByRole('banner');
  await expect(header.getByRole('heading', { level: 1 })).toHaveText('Agent Board');
  await expect(header).toContainText('Agent Board');
});

test('three lanes show their names and card counts', async ({ page }) => {
  const counts = { Todo: '3', Doing: '3', Done: '2' } as const;
  for (const [name, count] of Object.entries(counts) as [keyof typeof counts, string][]) {
    const column = lane(page, name);
    await expect(column.getByRole('heading', { level: 2 })).toHaveText(name);
    await expect(column.getByText(count, { exact: true })).toBeVisible();
    await expect(column.getByRole('button')).toHaveCount(Number(count));
  }
  await expect(page.getByRole('region')).toHaveCount(3);
});

test('a card shows its ID, title, and update time', async ({ page }) => {
  await expect(
    lane(page, 'Todo').getByRole('button', { name: '#14 Prepare the Windows build User Updated 10/02 10:08' }),
  ).toBeVisible();
  await expect(
    lane(page, 'Todo').getByRole('button', { name: '#15 Write the setup guide AI Updated 10/02 09:25' }),
  ).toBeVisible();
  await expect(
    lane(page, 'Done').getByRole('button', { name: '#8 Initialize the board AI Updated 10/02 09:48' }),
  ).toBeVisible();
  // Todo and Doing are oldest first.
  await expect(lane(page, 'Todo').getByRole('button')).toHaveText([
    /^#14(?!\d)/,
    /^#15(?!\d)/,
    /^#16(?!\d)/,
  ]);
});

test('Doing cards show Idle, Running, or Pending, and a pending card shows its reason', async ({
  page,
}) => {
  const doing = lane(page, 'Doing');
  await expect(
    doing.getByRole('button', { name: '#11 Running Implement card moves AI Updated 10/02 10:42' }),
  ).toBeVisible();
  await expect(
    doing.getByRole('button', { name: '#13 Idle Check the board display AI Updated 10/02 10:12' }),
  ).toBeVisible();
  const pending = doing.getByRole('button', { name: /^#12 Pending Restore a board from JSON AI / });
  await expect(pending).toBeVisible();
  await expect(pending).toContainText('Waiting for confirmation on how to replace a board.');

  // Only Doing cards carry a run state.
  for (const name of ['Todo', 'Done'] as const) {
    const column = lane(page, name);
    await expect(column.getByText(/^(Idle|Running|Pending)$/)).toHaveCount(0);
  }
});

test('Done lists the newest card first', async ({ page }) => {
  await expect(lane(page, 'Done').getByRole('button')).toHaveText([/^#9(?!\d)/, /^#8(?!\d)/]);
});

test('the footer shows the card count and the sync time', async ({ page }) => {
  const footer = page.getByRole('contentinfo');
  await expect(footer).toContainText('8 cards');
  const status = footer.getByRole('status');
  await expect(status).toHaveText(/^Synced \d{2}:\d{2}$/);

  // The sync time is the browser's local time (UTC here), within a minute of now.
  const shown = (await status.innerText()).replace('Synced ', '');
  const [hours, minutes] = shown.split(':').map(Number);
  const now = new Date();
  const diff = Math.abs(hours * 60 + minutes - (now.getUTCHours() * 60 + now.getUTCMinutes()));
  expect(Math.min(diff, 1440 - diff)).toBeLessThanOrEqual(1);
});
