import { expect, test, type Page } from '../helpers/fixtures';
import { ensureProject, makeHome, projectId, removeHome, startServe, type Serve } from '../helpers/agboard';

// The first-run guide runs in the browser: its two sample cards are drawn over the board and never
// written to it, and the server only keeps whether the guide has been seen. Each test starts its
// own serve with its own data area, so the board tests are not affected.

const PROJECT = 'guide';
let home = '';
let serve: Serve | null = null;

async function openBoard(guide: 'unseen' | 'skipped' = 'unseen'): Promise<string> {
	home = makeHome('onboarding', guide);
	ensureProject(PROJECT, home);
	serve = await startServe(home);
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

async function guideStatus(url: string): Promise<string> {
	const response = await fetch(`${url}api/onboarding`);
	return ((await response.json()) as { status: string }).status;
}

/** The titles of the open cards the server holds for the project. */
async function serverTitles(url: string): Promise<string[]> {
	const response = await fetch(`${url}api/projects/${projectId(PROJECT, home)}/summary`);
	const body = (await response.json()) as { tasks: { title: string }[] };
	return body.tasks.map((task) => task.title);
}

/** The board's own cards (not the spotlight's copies) whose title starts with "Sample:". */
function boardSamples(page: Page) {
	return page.locator('main .card').filter({ hasText: 'Sample:' });
}

/** Walks the guide to its last step, answering the question in the sample answer form. */
async function walkToComplete(page: Page, answer: (page: Page) => ReturnType<Page['getByRole']>) {
	await page.getByRole('button', { name: 'Watch it move' }).click();
	await expect(page.getByText('Guide 2 / 4')).toBeVisible();
	await page.getByRole('button', { name: 'Next' }).click({ timeout: 15_000 });
	await expect(page.getByText('The first card is done')).toBeVisible();
	await page.getByRole('button', { name: 'Next' }).click();

	await expect(page.getByText('Guide 3 / 4')).toBeVisible();
	await expect(page.locator('.onboarding-panel__badge')).toHaveText('Waiting for you');
	const stage = page.getByRole('dialog', { name: 'Guide' });
	await stage.getByRole('button', { name: 'Answer the question' }).click();
	const form = answer(page);
	await form.getByLabel('Keep it brief').check();
	await form.getByRole('button', { name: 'Send answer', exact: true }).click();

	await expect(page.getByText('Guide 4 / 4')).toBeVisible();
	await page.getByRole('button', { name: 'Next' }).click({ timeout: 15_000 });
	await expect(page.getByText('You have completed the guide')).toBeVisible();
}

const dialogWithNote = (page: Page) =>
	page.getByRole('dialog').filter({ has: page.getByRole('textbox', { name: 'Note' }) });

test('OB-01: the guide runs both samples, takes the answer, and leaves the board alone', async ({ page }) => {
	const url = await openBoard();
	await page.goto(url);

	await expect(page.getByText('Try Agent Board')).toBeVisible();
	await page.getByRole('button', { name: 'Start guide' }).click();
	await expect(page.getByText('Guide 1 / 4')).toBeVisible();
	// The samples are the guide's own: the board and the server have none of them.
	await expect(boardSamples(page)).toHaveCount(0);
	await expect(page.getByRole('dialog', { name: 'Guide' }).getByText('Sample: follow a task')).toBeVisible();

	await walkToComplete(page, dialogWithNote);
	await page.getByRole('button', { name: 'Finish and get started' }).click();
	await expect(page.getByRole('dialog')).toHaveCount(0);

	await expect.poll(() => guideStatus(url)).toBe('completed');
	expect(await serverTitles(url)).toEqual([]);
	await page.reload();
	await expect(page.getByText('Try Agent Board')).toBeHidden();
});

test('OB-02: skipping records it and the guide is not shown again', async ({ page }) => {
	const url = await openBoard();
	await page.goto(url);
	await expect(page.getByText('Try Agent Board')).toBeVisible();
	await page.getByRole('button', { name: 'Skip' }).click();
	await expect(page.getByText('Try Agent Board')).toBeHidden();
	await expect.poll(() => guideStatus(url)).toBe('skipped');

	await page.reload();
	await expect(page.getByText('Try Agent Board')).toBeHidden();
});

test('OB-03: ending an offered guide early records a skip', async ({ page }) => {
	const url = await openBoard();
	await page.goto(url);
	await page.getByRole('button', { name: 'Start guide' }).click();
	await page.getByRole('button', { name: 'Watch it move' }).click();
	await expect(page.getByText('Guide 2 / 4')).toBeVisible();

	await page.getByRole('button', { name: 'End guide' }).click();
	await expect(page.getByText('Guide 2 / 4')).toBeHidden();
	await expect.poll(() => guideStatus(url)).toBe('skipped');
	expect(await serverTitles(url)).toEqual([]);
});

test('OB-04: the settings show the tutorial again, and ending a replay records nothing', async ({ page }) => {
	const url = await openBoard('skipped');
	await page.goto(url);
	await expect(page.getByText('Try Agent Board')).toBeHidden();

	await page.getByRole('button', { name: 'Settings' }).click();
	await page.getByRole('button', { name: 'Try it' }).click();
	await expect(page.getByText('Try Agent Board')).toBeVisible();

	await page.getByRole('button', { name: 'Start guide' }).click();
	await expect(page.getByText('Guide 1 / 4')).toBeVisible();
	await page.getByRole('button', { name: 'End guide' }).click();

	await expect(page.getByText('Guide 1 / 4')).toBeHidden();
	expect(await guideStatus(url)).toBe('skipped');
	expect(await serverTitles(url)).toEqual([]);
});

test('OB-05: a second tab can show the guide at the same time', async ({ page, context }) => {
	const url = await openBoard();
	await page.goto(url);
	await expect(page.getByText('Try Agent Board')).toBeVisible();

	const other = await context.newPage();
	await other.goto(url);
	await expect(other.getByText('Try Agent Board')).toBeVisible();
	await other.getByRole('button', { name: 'Start guide' }).click();
	await expect(other.getByText('Guide 1 / 4')).toBeVisible();
	await expect(page.getByText('Try Agent Board')).toBeVisible();
});

const PHONE = { width: 390, height: 844 };

test('OB-06: at phone width the guide runs to the end, with the answer given in the sheet', async ({ page }) => {
	const url = await openBoard();
	await page.setViewportSize(PHONE);
	await page.goto(url);

	await expect(page.getByText('Try Agent Board')).toBeVisible();
	await page.getByRole('button', { name: 'Start guide' }).click();
	await expect(page.getByText('Guide 1 / 4')).toBeVisible();
	await page.getByRole('button', { name: 'Watch it move' }).click();
	await expect(page.getByText('Guide 2 / 4')).toBeVisible();
	await page.getByRole('button', { name: 'Next' }).click({ timeout: 15_000 });
	await expect(page.getByText('The first card is done')).toBeVisible();
	await page.getByRole('button', { name: 'Next' }).click();

	await expect(page.getByText('Guide 3 / 4')).toBeVisible();
	const stage = page.getByRole('dialog', { name: 'Guide' });
	await stage.getByRole('button', { name: 'Answer the question' }).click();
	// While the sheet is open the explanation is a strip: its title and body are gone.
	await expect(page.locator('.onboarding-panel--compact')).toBeVisible();
	const sheet = dialogWithNote(page);
	await sheet.getByLabel('Keep it brief').check();
	await sheet.getByRole('button', { name: 'Send answer', exact: true }).click();

	await expect(page.getByText('Guide 4 / 4')).toBeVisible();
	await expect(page.locator('.onboarding-panel--compact')).toHaveCount(0);
	await page.getByRole('button', { name: 'Next' }).click({ timeout: 15_000 });
	await expect(page.getByText('You have completed the guide')).toBeVisible();
	await page.getByRole('button', { name: 'Finish and get started' }).click();
	await expect(page.getByRole('dialog')).toHaveCount(0);

	await expect.poll(() => guideStatus(url)).toBe('completed');
});

test('OB-07: a change of width in the middle of the guide keeps the screen it is on', async ({ page }) => {
	const url = await openBoard();
	await page.goto(url);
	await page.getByRole('button', { name: 'Start guide' }).click();
	await page.getByRole('button', { name: 'Watch it move' }).click();
	await expect(page.getByText('Guide 2 / 4')).toBeVisible();

	// To the phone: the same step, now over the phone screen.
	await page.setViewportSize(PHONE);
	await expect(page.getByText('Guide 2 / 4')).toBeVisible();
	await expect(page.locator('.monitor-shell')).toBeVisible();
	await page.getByRole('button', { name: 'Next' }).click({ timeout: 15_000 });
	await expect(page.getByText('The first card is done')).toBeVisible();
	await page.getByRole('button', { name: 'Next' }).click();
	await expect(page.getByText('Guide 3 / 4')).toBeVisible();

	// Back to the PC board: still step 3, the question still waits on its card.
	await page.setViewportSize({ width: 1280, height: 900 });
	await expect(page.getByText('Guide 3 / 4')).toBeVisible();
	await expect(page.locator('.monitor-shell')).toHaveCount(0);
	await expect(page.getByRole('dialog', { name: 'Guide' }).getByRole('button', { name: 'Answer the question' })).toBeVisible();
});
