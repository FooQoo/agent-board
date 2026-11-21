import { expect, test } from '../helpers/fixtures';
import { mainProject, resetBoard } from '../helpers/agboard';
import { stubArchivePages } from '../helpers/archive-pages';
import { resetPreferences } from '../helpers/preferences';

// #664: the PC archive list reads 50 tasks at a time and reads the next page when the last row comes into view.
// The server's paging is tested in Rust; here the reads are answered with 130 synthetic tasks.
test.beforeEach(() => resetPreferences());
test.afterEach(() => resetPreferences());

const TOTAL = 130;

async function openArchive(page: import('@playwright/test').Page) {
	resetBoard(mainProject);
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto('/');
	await page.locator('.header__archive').click();
}

const scrollToBottom = (page: import('@playwright/test').Page) =>
	page.locator('.list-pane').evaluate((pane) => pane.scrollTo(0, pane.scrollHeight));

test('the PC archive list loads the next page as the last row comes into view and ends after the last', async ({
	page,
}) => {
	const reads = await stubArchivePages(page, { total: TOTAL });
	await openArchive(page);

	await expect(page.locator('.list-pane__count')).toHaveText('130 archived tasks');
	await expect(page.locator('.archive-row').first()).toContainText('#130');
	// Only the rows near the viewport are drawn, and only the first page was read.
	expect(await page.locator('.archive-row').count()).toBeLessThan(50);
	expect(reads.map((read) => read.cursor)).toEqual([null]);

	await expect
		.poll(async () => {
			await scrollToBottom(page);
			return page.getByTestId('archive-end').isVisible();
		})
		.toBe(true);
	expect(reads.map((read) => read.cursor)).toEqual([null, '50', '100']);
	expect(reads.every((read) => read.limit === 50)).toBe(true);
	await expect(page.locator('.archive-row').last()).toContainText('#1');
	await expect(page.locator('.list-pane__count')).toHaveText('130 archived tasks');
	await page.screenshot({ path: test.info().outputPath('archive-paging-pc-end.png') });
});

test('a failed page shows a retry under the rows and reads again only when it is pressed', async ({ page }) => {
	const reads = await stubArchivePages(page, { total: TOTAL, failAt: 50 });
	await openArchive(page);
	await expect(page.locator('.archive-row').first()).toContainText('#130');

	await expect
		.poll(async () => {
			await scrollToBottom(page);
			return page.getByText('Could not load more archived tasks.').isVisible();
		})
		.toBe(true);
	const failedReads = reads.length;
	// It does not ask again by itself.
	await page.waitForTimeout(500);
	expect(reads.length).toBe(failedReads);
	// The rows read so far are still there.
	expect(await page.locator('.archive-row').count()).toBeGreaterThan(0);

	await page.getByRole('button', { name: 'Retry' }).click();
	await expect
		.poll(async () => {
			await scrollToBottom(page);
			return page.getByTestId('archive-end').isVisible();
		})
		.toBe(true);
	await expect(page.getByText('Could not load more archived tasks.')).toHaveCount(0);
	await expect(page.locator('.archive-row').last()).toContainText('#1');
});
