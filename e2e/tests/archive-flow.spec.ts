import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { agboardOk, listTasks, mainProject, nextTaskId, resetBoard } from '../helpers/agboard';
import { resetPreferences, setPreferences } from '../helpers/preferences';
import { waitForSync } from '../helpers/ui';

test.beforeEach(() => resetPreferences());
test.afterEach(() => resetPreferences());

const png = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==',
	'base64',
);

test('real archive detail preserves content, restores the lane, and permanently deletes an archived task', async ({
	page,
}, testInfo) => {
	resetBoard(mainProject);
	const keepId = nextTaskId(mainProject);
	const keepTitle = 'Archive flow keep with attachment';
	const keepDescription = 'Preserve this **Markdown** description through archive and restore.';
	agboardOk(mainProject, [
		'add',
		keepTitle,
		'--desc',
		keepDescription,
		'--assignee',
		'ai',
		'--actor',
		'ai',
	]);
	const imagePath = testInfo.outputPath('archive-attachment.png');
	writeFileSync(imagePath, png);
	agboardOk(mainProject, ['attachment', 'add', String(keepId), '--file', imagePath, '--actor', 'ai']);
	agboardOk(mainProject, ['mv', String(keepId), 'done', '--actor', 'ai', '--reason', 'Prepare archive E2E']);

	const deleteId = nextTaskId(mainProject);
	const deleteTitle = 'Archive flow permanent delete';
	agboardOk(mainProject, [
		'add',
		deleteTitle,
		'--assignee',
		'human',
		'--actor',
		'ai',
	]);
	agboardOk(mainProject, ['mv', String(deleteId), 'done', '--actor', 'ai', '--reason', 'Prepare delete E2E']);

	await page.setViewportSize({ width: 1280, height: 900 });
	await setPreferences({ locale: 'ja', theme: { mode: 'light', accent: 'blue' } });
	await page.goto('/');
	await waitForSync(page);

	const done = page.getByRole('region', { name: '完了' });
	await done.getByRole('button', { name: new RegExp(keepTitle) }).click();
	const detail = page.locator('.detail');
	await detail.getByRole('button', { name: 'タスクをアーカイブ' }).click();
	await detail.getByRole('button', { name: 'アーカイブ', exact: true }).click();
	await expect(done.getByRole('button', { name: new RegExp(keepTitle) })).toHaveCount(0);
	await expect.poll(() => listTasks(mainProject).some((task) => task.id === keepId)).toBe(false);

	await page.locator('.header__archive').click();
	const archivedRow = page.locator('.archive-row > button').filter({ hasText: keepTitle });
	await expect(archivedRow).toBeVisible();
	await archivedRow.click();
	await expect(detail.getByRole('tabpanel')).toContainText('Preserve this Markdown description through archive and restore.');
	await expect(detail.locator('.detail-attachments__tile')).toHaveCount(1);
	await expect(detail.getByRole('tab', { name: /^履歴/ })).toContainText('履歴');
	await page.screenshot({ path: testInfo.outputPath('01-archive-detail.png') });

	await detail.getByRole('button', { name: 'タスクを削除' }).click();
	const penCopy = `#${keepId}「${keepTitle}」を削除しますか？ 本文・画像・履歴も削除されます。この操作は元に戻せません。`;
	await expect(detail.locator('.delete-confirm__message')).toHaveText(penCopy);
	const geometry = await detail.evaluate((element) => {
		const rect = (selector: string) => {
			const box = element.querySelector(selector)!.getBoundingClientRect();
			return { x: box.x, y: box.y, width: box.width, height: box.height };
		};
		return {
			viewport: { width: innerWidth, height: innerHeight },
			actions: rect('.detail__top .detail__toolbar'),
			confirmation: rect('.delete-confirm'),
			tabs: rect('.detail__tabs'),
		};
	});
	writeFileSync(testInfo.outputPath('archive-delete-geometry.json'), JSON.stringify(geometry, null, 2));
	await page.screenshot({ path: testInfo.outputPath('02-archive-delete-confirmation.png') });
	await detail.getByRole('button', { name: 'キャンセル' }).click();
	await detail.getByRole('button', { name: '復元' }).click();
	await expect.poll(() => listTasks(mainProject).find((task) => task.id === keepId)?.taskStatus).toBe('done');
	await expect.poll(() => listTasks(mainProject).find((task) => task.id === keepId)?.agentStatus).toBe('idle');
	const restored = listTasks(mainProject).find((task) => task.id === keepId)!;
	expect(restored).toMatchObject({ title: keepTitle, taskStatus: 'done', agentStatus: 'idle' });

	const deleteTask = page.getByRole('button', { name: new RegExp(deleteTitle) });
	await page.locator('.header__back').click();
	await expect(deleteTask).toBeVisible();
	await page.getByRole('region', { name: '完了' }).getByRole('button', { name: new RegExp(deleteTitle) }).click();
	await detail.getByRole('button', { name: 'タスクをアーカイブ' }).click();
	await detail.getByRole('button', { name: 'アーカイブ', exact: true }).click();
	await page.locator('.header__archive').click();
	await page.locator('.archive-row > button').filter({ hasText: deleteTitle }).click();
	await detail.getByRole('button', { name: 'タスクを削除' }).click();
	await detail.getByRole('button', { name: '削除', exact: true }).click();
	await expect(page.locator('.archive-row > button').filter({ hasText: deleteTitle })).toHaveCount(0);
	const finalTasks = listTasks(mainProject);
	expect(finalTasks.some((task) => task.id === deleteId)).toBe(false);
});
