import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mainHome, mainProject, projectId, resetBoard } from '../helpers/agboard';
import { messageList, openMessageList } from '../helpers/answer';
import { expect, test } from '../helpers/fixtures';
import { readBoardAfterReset, waitForSync } from '../helpers/ui';

// The Summary tab of the messages: it lists the periodic summaries found in the project's notify
// folder, and the trash sets one aside without removing its line.

const line = (id: string, end: string, taskId: number, title: string) =>
  JSON.stringify({
    id,
    dismissed: false,
    from: '2026-11-20T09:00:00Z',
    to: end,
    results: [{ taskId, title, at: '2026-11-20T09:30:00Z' }],
  });

function notifyFile(): string {
  return path.join(mainHome(), 'shared', 'projects', projectId(mainProject), 'notify', '2026-11-20.ldjson');
}

function writeSummaries(): void {
  const file = notifyFile();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    `${line('s-20261120T100000Z', '2026-11-20T10:00:00Z', 552, 'Pull to refresh on the phone board')}\n${line('s-20261120T110000Z', '2026-11-20T11:00:00Z', 553, 'Bottom navigation bar')}\n`,
  );
}

const records = () =>
  readFileSync(notifyFile(), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { id: string; dismissed: boolean });

test.beforeEach(() => {
  resetBoard(mainProject);
  writeSummaries();
});

test.afterEach(() => {
  rmSync(path.dirname(notifyFile()), { recursive: true, force: true });
});

test('the Summary tab lists the summaries and the trash dismisses one', async ({ page }) => {
  await page.goto('/');
  await waitForSync(page);
  await readBoardAfterReset(page);
  const list = await openMessageList(page);
  const tab = list.getByRole('tab', { name: /^Summary/ });
  await expect(tab).toContainText('2');
  await tab.click();

  await expect(list.getByText('#552')).toBeVisible();
  await expect(list.getByText('Pull to refresh on the phone board')).toBeVisible();
  await expect(list.getByText('#553')).toBeVisible();

  // The newest window is first; its trash button is on the left of the item.
  const trash = list.getByRole('button', { name: 'Delete this summary' });
  await expect(trash).toHaveCount(2);
  await trash.first().click();

  await expect(list.getByText('#553')).toHaveCount(0);
  await expect(list.getByText('#552')).toBeVisible();
  await expect(tab).toContainText('1');
  // The record stays on disk with `dismissed` set.
  await expect.poll(() => records().find((r) => r.id === 's-20261120T110000Z')?.dismissed).toBe(true);
  expect(records()).toHaveLength(2);

  // A reload still hides it.
  await page.reload();
  const again = await openMessageList(page);
  await again.getByRole('tab', { name: /^Summary/ }).click();
  await expect(again.getByText('#553')).toHaveCount(0);
  await expect(again.getByText('#552')).toBeVisible();
});

test('a summary link opens the messages on the Summary tab', async ({ page }) => {
  await page.goto(`/?project=${projectId(mainProject)}&messages=summary`);
  const list = messageList(page);
  await expect(list).toBeVisible();
  await expect(list.getByRole('tab', { name: /^Summary/ })).toHaveAttribute('aria-selected', 'true');
  await expect(list.getByText('#552')).toBeVisible();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('a tap shows the trash tile and tapping it dismisses the summary', async ({ page }) => {
    await page.goto(`/?project=${projectId(mainProject)}&messages=summary`);
    const sheet = messageList(page);
    await expect(sheet.getByRole('tab', { name: /^Summary/ })).toHaveAttribute('aria-selected', 'true');
    await expect(sheet.getByText('#553')).toBeVisible();

    await sheet.getByText(/^11\/20 /).first().tap();
    const tile = sheet.getByRole('button', { name: 'Delete this summary' }).first();
    await expect(tile).toBeVisible();
    await tile.tap();

    await expect(sheet.getByText('#553')).toHaveCount(0);
    await expect.poll(() => records().filter((r) => r.dismissed).length).toBe(1);
  });
});
