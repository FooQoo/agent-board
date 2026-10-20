import { expect, test } from '@playwright/test';
import { agboardOk, mainProject, nextTaskId, resetBoard } from '../helpers/agboard';
import { waitForSync } from '../helpers/ui';

// The epic list from the header: every epic with its task counts, the details beside it, the existing editor,
// and the counts that follow a task's state. Each test seeds its own epics so they do not depend on the fixture.

const row = (page: import('@playwright/test').Page, name: string) =>
	page.getByRole('list', { name: 'Epics in this project' }).getByRole('listitem').filter({ hasText: name });

const actionGap = (page: import('@playwright/test').Page) =>
	page.locator('.detail__top').evaluate((header) => {
		const action = header.querySelector('.detail__toolbar button:last-child svg');
		const close = header.querySelector('.detail__close svg');
		if (!action || !close) throw new Error('The detail actions did not render.');
		return close.getBoundingClientRect().left - action.getBoundingClientRect().right;
	});

test('epic details confirm deletion, retain refusals, and remove an unused epic', async ({ page }) => {
	resetBoard(mainProject);
	agboardOk(mainProject, ['epic', 'add', 'EMPTYDEL', '--name', 'Empty epic sample', '--actor', 'ai']);
	agboardOk(mainProject, ['epic', 'add', 'USEDDEL', '--name', 'Occupied epic sample', '--actor', 'ai']);
	agboardOk(mainProject, ['add', 'Keep the used epic', '--assignee', 'ai', '--actor', 'ai', '--epic', 'USEDDEL']);
	await page.goto('/');
	await waitForSync(page);
	await page.getByRole('button', { name: 'Epics', exact: true }).click();
	await row(page, 'Occupied epic sample').getByRole('button').first().click();
	await page.getByRole('button', { name: 'Delete epic', exact: true }).click();
	const confirm = page.getByRole('dialog');
	await confirm.getByRole('button', { name: 'Delete epic', exact: true }).click();
	await expect(confirm.getByRole('alert')).toContainText('A task still uses this epic');
	await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
	await row(page, 'Empty epic sample').getByRole('button').first().click();
	await page.getByRole('button', { name: 'Delete epic', exact: true }).click();
	await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(row(page, 'Empty epic sample')).toBeVisible();
	await page.getByRole('button', { name: 'Delete epic', exact: true }).click();
	await confirm.getByRole('button', { name: 'Delete epic', exact: true }).click();
	await expect(confirm).toHaveCount(0);
	await expect(row(page, 'Empty epic sample')).toHaveCount(0);
	await expect(page.getByText('Select an epic to see its details.')).toBeVisible();
});

test('the header lists the epics with their counts, and selecting one shows its details beside the list', async ({
	page,
}) => {
	resetBoard(mainProject);
	agboardOk(mainProject, ['epic', 'add', 'LISTFLOW', '--name', 'Epic list flow', '--actor', 'ai']);
	agboardOk(mainProject, ['add', 'Flow todo', '--assignee', 'ai', '--actor', 'ai', '--epic', 'LISTFLOW']);
	const doingId = nextTaskId(mainProject);
	agboardOk(mainProject, ['add', 'Flow doing', '--assignee', 'ai', '--actor', 'ai', '--epic', 'LISTFLOW']);
	agboardOk(mainProject, ['mv', String(doingId), 'doing', '--actor', 'ai', '--reason', 'Start']);

	await page.goto('/');
	await waitForSync(page);
	await page.getByRole('button', { name: /Flow todo/ }).click();
	const taskActionGap = await actionGap(page);
	await page.getByRole('button', { name: 'Close details' }).click();
	await page.getByRole('button', { name: 'Epics' }).click();

	const flow = row(page, 'Epic list flow');
	await expect(flow).toBeVisible();
	await expect(flow).toContainText('Total 2 tasks');
	const counts = flow.getByRole('group', { name: 'Tasks by state' });
	await expect(counts.getByText('Todo').locator('xpath=following-sibling::*[1]')).toHaveText('1');
	await expect(counts.getByText('Doing').locator('xpath=following-sibling::*[1]')).toHaveText('1');
	await expect(page.getByText('Select an epic to see its details.')).toBeVisible();

	await flow.getByRole('button').first().click();
	await expect(page.getByRole('heading', { level: 2, name: 'Epic list flow' })).toBeVisible();
	expect(await actionGap(page)).toBeCloseTo(taskActionGap, 1);
	await expect(page.getByRole('separator', { name: 'Resize task details' })).toBeVisible();

	// The existing editor opens from the details; cancelling keeps the same list and selection.
	await page.getByRole('button', { name: 'Edit epic' }).click();
	await expect(page.getByLabel('Title')).toHaveValue('Epic list flow');
	await page.getByRole('button', { name: 'Cancel' }).click();
	await expect(page.getByRole('heading', { level: 2, name: 'Epic list flow' })).toBeVisible();

	// Saving renames the epic in the list and in the details.
	await page.getByRole('button', { name: 'Edit epic' }).click();
	await page.getByLabel('Title').fill('Epic list renamed');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByRole('heading', { level: 2, name: 'Epic list renamed' })).toBeVisible();
	await expect(row(page, 'Epic list renamed')).toBeVisible();

	// Closing the details shows the prompt again, in the same column; Back to board returns to the board.
	await page.getByRole('button', { name: 'Close details' }).click();
	await expect(page.getByText('Select an epic to see its details.')).toBeVisible();
	await page.getByRole('button', { name: 'Back to board' }).click();
	await expect(page.getByRole('region', { name: 'Todo' })).toBeVisible();
});

test('an epic with no tasks reads zero in every state', async ({ page }) => {
	resetBoard(mainProject);
	agboardOk(mainProject, ['epic', 'add', 'NOTASKS', '--name', 'No tasks yet', '--actor', 'ai']);

	await page.goto('/');
	await waitForSync(page);
	await page.getByRole('button', { name: 'Epics' }).click();

	const empty = row(page, 'No tasks yet');
	await expect(empty).toContainText('Total 0 tasks');
	const counts = empty.getByRole('group', { name: 'Tasks by state' });
	for (const label of ['Todo', 'Doing', 'Done', 'Archived']) {
		await expect(counts.getByText(label, { exact: true }).locator('xpath=following-sibling::*[1]')).toHaveText('0');
	}
});

test('a task archived from the board is counted as archived in its epic, once', async ({ page }) => {
	resetBoard(mainProject);
	agboardOk(mainProject, ['epic', 'add', 'ARCHCOUNT', '--name', 'Archive count', '--actor', 'ai']);
	agboardOk(mainProject, ['add', 'Counted once', '--assignee', 'ai', '--actor', 'ai', '--epic', 'ARCHCOUNT']);

	await page.goto('/');
	await waitForSync(page);
	await page.getByRole('button', { name: /Counted once/ }).click();
	const taskActionGap = await actionGap(page);
	const detail = page.locator('.detail');
	await detail.getByRole('button', { name: 'Archive task' }).click();
	await detail.getByRole('button', { name: 'Archive', exact: true }).click();
	await expect(page.getByRole('button', { name: /Counted once/ })).toHaveCount(0);
	await page.locator('.header__archive').click();
	await page.locator('.archive-row > button').filter({ hasText: 'Counted once' }).click();
	expect(await actionGap(page)).toBeCloseTo(taskActionGap, 1);
	await page.getByRole('button', { name: 'Back to board' }).click();

	await page.getByRole('button', { name: 'Epics' }).click();
	const archived = row(page, 'Archive count');
	await expect(archived).toContainText('Total 1 task');
	const counts = archived.getByRole('group', { name: 'Tasks by state' });
	await expect(counts.getByText('Todo', { exact: true }).locator('xpath=following-sibling::*[1]')).toHaveText('0');
	await expect(counts.getByText('Archived', { exact: true }).locator('xpath=following-sibling::*[1]')).toHaveText('1');
});
