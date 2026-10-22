import { expect, test, type Page } from '@playwright/test';
import { ensureProject, makeHome, projectId, removeHome, startServe, statesPort, type Serve } from '../helpers/agboard';

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

	// The first card runs. Next is enabled once the running minimum has passed, and the card is then Done.
	await expect(page.getByText('Guide 2 / 4')).toBeVisible({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Next' }).click();
	await expect(page.getByText('The first card is done')).toBeVisible();
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

async function openSkippedBoard(): Promise<string> {
	home = makeHome('onboarding-tutorial', 'skipped');
	ensureProject(PROJECT, home);
	serve = await startServe(statesPort, home);
	return serve.url;
}

test('OB-04: the settings start the tutorial again, and ending it archives its samples', async ({ page }) => {
	const url = await openSkippedBoard();
	await page.goto(url);
	await expect(page.getByText('Try Agent Board')).toBeHidden();

	await page.getByRole('button', { name: 'Settings' }).click();
	await page.getByRole('button', { name: 'Try it' }).click();
	await expect(page.getByText('Try Agent Board')).toBeVisible();

	await page.getByRole('button', { name: 'Start guide' }).click();
	await expect(page.getByText('Guide 1 / 4')).toBeVisible();
	await page.getByRole('button', { name: 'End guide' }).click();

	await expect(page.getByText('Guide 1 / 4')).toBeHidden();
	expect(await sampleCardTitles(page)).toEqual([]);
	expect((await guideState(url)).status).toBe('interrupted');
});

/** The titles of the cards the server holds for a project, from the board (open cards) or the archive. */
async function serverTitles(url: string, id: string, list: 'board' | 'archive'): Promise<string[]> {
	const response = await fetch(`${url}api/projects/${id}/${list}`);
	expect(response.ok).toBe(true);
	const body = (await response.json()) as { tasks: { title: string }[] };
	return body.tasks.map((task) => task.title).sort();
}

test('OB-05: a tutorial started in a second project puts its samples on that project', async ({ page }) => {
	home = makeHome('onboarding-switch', 'skipped');
	ensureProject('first', home);
	ensureProject('second', home);
	serve = await startServe(statesPort, home);
	const url = serve.url;
	await page.goto(url);

	// Whichever project opens first, the other one is the second project the user switches to.
	const switcher = page.locator('header .project-switcher');
	await expect(switcher).toHaveText(/^(first|second)$/);
	const opened = (await switcher.innerText()).trim();
	const target = opened === 'first' ? 'second' : 'first';
	const openedId = projectId(opened, home);
	const targetId = projectId(target, home);
	await switcher.click();
	await page.getByRole('menuitemradio', { name: target, exact: true }).click();
	await expect(switcher).toHaveText(target);
	await expect.poll(() => new URL(page.url()).searchParams.get('project')).toBe(targetId);
	await expect(page.getByText('Try Agent Board')).toBeHidden();

	await page.getByRole('button', { name: 'Settings' }).click();
	await page.getByRole('button', { name: 'Try it' }).click();
	await expect(page.getByText('Try Agent Board')).toBeVisible();
	await page.getByRole('button', { name: 'Start guide' }).click();
	await expect(page.getByText('Guide 1 / 4')).toBeVisible();

	// The board behind the guide shows exactly the two cards of the run (the guide's spotlight shows copies of them).
	const samples = ['Sample: choose the guide style', 'Sample: follow a task'];
	const boardCards = page.locator('main .card').filter({ hasText: 'Sample:' });
	await expect(boardCards).toHaveCount(2);
	await expect(boardCards.filter({ hasText: samples[0] })).toHaveCount(1);
	await expect(boardCards.filter({ hasText: samples[1] })).toHaveCount(1);
	expect(new URL(page.url()).searchParams.get('project')).toBe(targetId);

	// The server agrees: the cards belong to the project on screen, and the project opened first has none.
	expect(await serverTitles(url, targetId, 'board')).toEqual(samples);
	expect(await serverTitles(url, openedId, 'board')).toEqual([]);

	await page.getByRole('button', { name: 'End guide' }).click();
	await expect(page.getByText('Guide 1 / 4')).toBeHidden();
	await expect.poll(async () => sampleCardTitles(page)).toEqual([]);
	expect((await guideState(url)).status).toBe('interrupted');
	expect(await serverTitles(url, targetId, 'board')).toEqual([]);
	expect(await serverTitles(url, targetId, 'archive')).toEqual(samples);
	expect(await serverTitles(url, openedId, 'archive')).toEqual([]);
});
