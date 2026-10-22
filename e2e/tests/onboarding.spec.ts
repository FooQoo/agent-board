import { expect, test, type Page } from '@playwright/test';
import { ensureProject, makeHome, removeHome, startServe, statesPort, type Serve } from '../helpers/agboard';

// The first-run guide on a data area that has never shown it. Each test starts its own
// serve on the states port, with its own data area, so the board tests are not affected.

const PROJECT = 'guide';
let home = '';
let serve: Serve | null = null;

async function openFreshBoard(): Promise<string> {
	home = makeHome('onboarding', 'unseen');
	ensureProject(PROJECT, home);
	serve = await startServe(statesPort, home);
	return serve.url;
}

test.afterEach(async () => {
	if (serve) {
		serve.process.kill();
		serve = null;
	}
	if (home) removeHome(home);
	home = '';
});

async function guideState(url: string): Promise<{ status: string; revision: number }> {
	const response = await fetch(`${url}api/onboarding`);
	return (await response.json()) as { status: string; revision: number };
}

/** The sample cards are the cards whose title starts with "Sample:" on the board. */
async function sampleCardTitles(page: Page): Promise<string[]> {
	return page.locator('.card').filter({ hasText: 'Sample:' }).allTextContents();
}

test('OB-01: the guide runs both samples, takes the answer, and archives them', async ({ page }) => {
	const url = await openFreshBoard();
	await page.goto(url);

	await expect(page.getByText('Try Agent Board')).toBeVisible();
	await page.getByRole('button', { name: 'Start guide' }).click();

	await expect(page.getByText('Guide 1 / 4')).toBeVisible();
	await page.getByRole('button', { name: 'Watch it move' }).click();

	// The first card runs, and finishes on its own after the running minimum.
	await expect(page.getByText('Guide 2 / 4')).toBeVisible({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Next' }).click();

	// The second card asks its question and waits for the user.
	await expect(page.getByText('Guide 3 / 4')).toBeVisible();
	await expect(page.locator('.onboarding-panel__badge')).toHaveText('Waiting for you');
	// The answer is given on the card inside the guide's spotlight, not on the card behind it.
	const stage = page.getByRole('dialog', { name: 'Guide' });
	await stage.getByLabel('Keep it brief').check();
	await stage.getByRole('button', { name: 'Send' }).click();

	await expect(page.getByText('Guide 4 / 4')).toBeVisible({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Next' }).click();

	await expect(page.getByText('You have completed the guide')).toBeVisible({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Finish and get started' }).click();
	await expect(page.getByText('The two sample tasks have been archived.')).toBeVisible();

	expect((await guideState(url)).status).toBe('completed');
	expect(await sampleCardTitles(page)).toEqual([]);
});

test('OB-02: skipping creates no sample cards and the guide is not shown again', async ({ page }) => {
	const url = await openFreshBoard();
	await page.goto(url);
	await expect(page.getByText('Try Agent Board')).toBeVisible();
	await page.getByRole('button', { name: 'Skip' }).click();
	await expect(page.getByText('Try Agent Board')).toBeHidden();
	expect((await guideState(url)).status).toBe('skipped');
	expect(await sampleCardTitles(page)).toEqual([]);

	await page.reload();
	await expect(page.getByText('Try Agent Board')).toBeHidden();
});

test('OB-03: ending the guide early archives its two cards and offers a new run', async ({ page }) => {
	const url = await openFreshBoard();
	await page.goto(url);
	await page.getByRole('button', { name: 'Start guide' }).click();
	await expect(page.getByText('Guide 1 / 4')).toBeVisible();
	await page.getByRole('button', { name: 'Watch it move' }).click();
	await expect(page.getByText('Guide 2 / 4')).toBeVisible({ timeout: 15_000 });

	await page.getByRole('button', { name: 'End guide' }).click();
	await expect(page.getByText('Guide 2 / 4')).toBeHidden();
	expect((await guideState(url)).status).toBe('interrupted');
	expect(await sampleCardTitles(page)).toEqual([]);

	await page.reload();
	await expect(page.getByText('Try Agent Board')).toBeVisible();
});
