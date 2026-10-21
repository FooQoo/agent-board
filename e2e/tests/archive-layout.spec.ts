import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { mainProject, resetBoard } from "../helpers/agboard";
import { resetPreferences, setPreferences } from "../helpers/preferences";

test.beforeEach(() => resetPreferences());
test.afterEach(() => resetPreferences());

for (const mode of ["light", "dark"] as const) {
	for (const locale of ["en", "ja"] as const) {
		for (const width of [960, 1280, 2048]) {
			test(`archive layout and confirmation at ${width}px, ${locale}, ${mode}`, async ({
				page,
			}, testInfo) => {
				resetBoard(mainProject);
				await page.setViewportSize({ width, height: 900 });
				await setPreferences({ locale, theme: { mode, accent: "blue" } });

				// Keep layout checks independent of writes; all cards are temporary response fixtures.
				await page.route("**/api/projects/*/board", async (route) => {
					const response = await route.fetch();
					const board = await response.json();
					const task = board.tasks.find(
						(item: { taskStatus: string }) => item.taskStatus === "done",
					);
					board.tasks = Array.from({ length: 24 }, (_, index) => ({
						...task,
						id: index + 1,
						title: `Archive layout task ${index + 1}: 日本語の長いタイトルと対象タスクの確認`,
						attachments: [],
					}));
					await route.fulfill({ json: board });
				});
				await page.route("**/api/projects/*/archive", async (route) => {
					const boardUrl = route
						.request()
						.url()
						.replace(/\/archive$/, "/board");
					const board = await (await page.request.get(boardUrl)).json();
					await route.fulfill({
						json: {
							...board,
							tasks: board.tasks.slice(0, 3).map((task: object) => ({
								...task,
								archivedAt: "2026-10-08T00:00:00Z",
								attachments: [],
							})),
						},
					});
				});
				await page.goto("/");
				await expect(page.locator(".lane-header__archive")).toBeEnabled();
				await page.locator(".header__archive").click();
				const archive = page.locator(".list-pane");
				const list = page.locator(".list-pane__rows");
				const row = page.locator(".archive-row > button").first();
				await expect(row).toBeVisible();
				const bodyBounds = (await page.locator(".app__body").boundingBox())!;
				const archiveBounds = (await archive.boundingBox())!;
				const rowBounds = (await row.boundingBox())!;
				const date = row.locator(".archive-row__date");
				expect(archiveBounds.width).toBeLessThan(bodyBounds.width);
				expect(archiveBounds.x + archiveBounds.width).toBeLessThanOrEqual(
					bodyBounds.width,
				);
				const listPadding = 48;
				expect(rowBounds.width).toBeCloseTo(
					archiveBounds.width - listPadding,
					0,
				);
				for (const selector of [
					".app__body",
					".list-pane",
					".list-pane__rows",
					".archive-row",
					".archive-row > button",
					".detail",
				]) {
					const pane = page.locator(selector).first();
					await expect(pane).toBeVisible();
					const { clientWidth, scrollWidth } = await pane.evaluate(
						(element) => ({
							clientWidth: element.clientWidth,
							scrollWidth: element.scrollWidth,
						}),
					);
					expect(
						scrollWidth,
						`${selector} must not overflow horizontally at ${width}px`,
					).toBeLessThanOrEqual(clientWidth);
				}
				const dateLineCount = await date.evaluate((element) => {
					const range = document.createRange();
					range.selectNodeContents(element);
					return range.getClientRects().length;
				});
				expect(
					dateLineCount,
					`archive date must stay on one line at ${width}px`,
				).toBe(1);
				await page.screenshot({
					path: testInfo.outputPath("01-archive-list.png"),
				});
				if (width === 1280 && locale === "ja" && mode === "light") {
					const detailBounds = (await page.locator(".detail").boundingBox())!;
					writeFileSync(
						testInfo.outputPath("archive-geometry.json"),
						JSON.stringify(
							{
								viewport: { width, height: 900 },
								url: page.url(),
								body: bodyBounds,
								archivePane: archiveBounds,
								row: rowBounds,
								detail: detailBounds,
							},
							null,
							2,
						),
					);
				}

				await row.click();
				const detail = page.locator(".detail");
				await expect(detail).toBeVisible();
				const detailBounds = (await detail.boundingBox())!;
				const listBounds = (await list.boundingBox())!;
				expect(detailBounds.x + detailBounds.width).toBeLessThanOrEqual(width);
				expect(detailBounds.x).toBeGreaterThan(listBounds.x + listBounds.width);
				expect(
					await page.evaluate(() => document.documentElement.scrollWidth),
				).toBeLessThanOrEqual(width);
				await page.screenshot({
					path: testInfo.outputPath("02-archive-detail.png"),
				});
				await detail.locator(".detail__close").click();
				await expect(detail.locator(".detail__empty-message")).toBeVisible();
				expect((await row.boundingBox())!.width).toBeCloseTo(
					rowBounds.width,
					0,
				);
				if (width === 1280 && locale === "ja" && mode === "light")
					await page.screenshot({
						path: testInfo.outputPath("03-archive-closed.png"),
					});
				await page.locator(".header__back").click();

				const trigger = page.locator(".lane-header__archive");
				await trigger.click();
				const dialog = page.getByRole("dialog");
				await expect(dialog).toBeVisible();
				await expect(dialog).toHaveAttribute("data-slot", "dialog-content");
				await expect(dialog.getByRole("row")).toHaveCount(25);
				for (const row of await dialog.getByRole("row").all()) {
					const idCell = row.locator("th, td").first();
					const idLayout = await idCell.evaluate((element) => ({
						whiteSpace: getComputedStyle(element).whiteSpace,
						clientWidth: element.clientWidth,
						scrollWidth: element.scrollWidth,
					}));
					expect(idLayout.whiteSpace).toBe("nowrap");
					expect(idLayout.scrollWidth).toBeLessThanOrEqual(
						idLayout.clientWidth,
					);
				}
				await expect(dialog.getByText("agent-board")).toBeVisible();
				await expect(
					dialog.getByText(
						locale === "ja"
							? "本文・画像・履歴は保持され、アーカイブ一覧から復元できます。"
							: "Descriptions, images, and history are kept. You can restore tasks from the archive.",
					),
				).toBeVisible();
				await expect(dialog.locator('[data-slot="dialog-close"]')).toHaveCount(
					0,
				);
				const cancel = dialog.getByRole("button", {
					name: locale === "ja" ? "キャンセル" : "Cancel",
					exact: true,
				});
				const submit = dialog.getByRole("button", {
					name: /archive 24 tasks|24件をアーカイブ/i,
				});
				const tableWrap = dialog.locator(".bulk-archive__table-wrap");
				await expect(cancel).toBeFocused();
				const dialogBounds = (await dialog.boundingBox())!;
				expect(dialogBounds.x).toBeGreaterThanOrEqual(15);
				expect(dialogBounds.x + dialogBounds.width).toBeLessThanOrEqual(
					width - 15,
				);
				expect(dialogBounds.y).toBeGreaterThanOrEqual(15);
				expect(dialogBounds.y + dialogBounds.height).toBeLessThanOrEqual(
					page.viewportSize()!.height - 15,
				);
				expect(
					await dialog
						.locator(".bulk-archive__table-wrap")
						.evaluate((element) => element.scrollHeight > element.clientHeight),
				).toBe(true);
				await dialog.getByRole("row").last().scrollIntoViewIfNeeded();
				await expect(cancel).toBeVisible();
				expect(
					await page
						.locator('[data-slot="dialog-overlay"]')
						.evaluate((element) => getComputedStyle(element).backgroundColor),
				).toBe("rgba(17, 24, 39, 0.4)");
				await page.screenshot({
					path: testInfo.outputPath("03-bulk-archive.png"),
				});
				await page.keyboard.press("Tab");
				await expect(submit).toBeFocused();
				await page.keyboard.press("Tab");
				await expect(tableWrap).toBeFocused();
				await page.keyboard.press("Tab");
				await expect(cancel).toBeFocused();
				await page.keyboard.press("Shift+Tab");
				await expect(tableWrap).toBeFocused();
				await page.keyboard.press("Shift+Tab");
				await expect(submit).toBeFocused();
				await page.keyboard.press("Shift+Tab");
				await expect(cancel).toBeFocused();
				await page.keyboard.press("Escape");
				await expect(dialog).toHaveCount(0);
				await expect(trigger).toBeFocused();
			});
		}
	}
}

for (const mode of ["light", "dark"] as const) {
	for (const locale of ["en", "ja"] as const) {
		test(`bulk archive fits 100 long targets at 360px, ${locale}, ${mode}`, async ({
			page,
		}, testInfo) => {
			resetBoard(mainProject);
			await page.setViewportSize({ width: 360, height: 800 });
			await setPreferences({ locale, theme: { mode, accent: "blue" } });
			await page.route("**/api/projects/*/board", async (route) => {
				const response = await route.fetch();
				const board = await response.json();
				const task = board.tasks.find(
					(item: { taskStatus: string }) => item.taskStatus === "done",
				);
				board.tasks = Array.from({ length: 100 }, (_, index) => ({
					...task,
					id: index + 1001,
					title:
						locale === "ja"
							? `検証対象タスク${index + 1}：アーカイブ確認用のとても長い日本語タイトルと保持説明`
							: `Verification task ${index + 1}: a deliberately long English title for archive retention`,
					assignee: index % 2 === 0 ? "ai" : "human",
					attachments: [],
				}));
				await route.fulfill({ json: board });
			});
			await page.goto("/");
			const trigger = page.locator(".lane-header__archive");
			await expect(trigger).toBeEnabled();
			await trigger.click();
			const dialog = page.getByRole("dialog");
			await expect(dialog).toBeVisible();
			await expect(dialog.getByRole("row")).toHaveCount(101);
			await expect(
				dialog.getByText(
					locale === "ja"
						? "本文・画像・履歴は保持され、アーカイブ一覧から復元できます。"
						: "Descriptions, images, and history are kept. You can restore tasks from the archive.",
				),
			).toBeVisible();
			await expect(dialog.getByRole("button", { name: /100/ })).toBeVisible();
			await expect(dialog.locator('[data-slot="dialog-close"]')).toHaveCount(0);
			const cancel = dialog.getByRole("button", {
				name: locale === "ja" ? "キャンセル" : "Cancel",
				exact: true,
			});
			await expect(cancel).toBeFocused();
			const bounds = (await dialog.boundingBox())!;
			expect(bounds.x).toBeGreaterThanOrEqual(15);
			expect(bounds.x + bounds.width).toBeLessThanOrEqual(345);
			expect(bounds.y).toBeGreaterThanOrEqual(15);
			expect(bounds.y + bounds.height).toBeLessThanOrEqual(785);
			const tableWrap = dialog.locator(".bulk-archive__table-wrap");
			const firstId = dialog.getByRole("row").nth(1).locator("td").first();
			await expect(firstId).toHaveCSS("white-space", "nowrap");
			expect(
				await firstId.evaluate(
					(element) => element.scrollWidth <= element.clientWidth,
				),
			).toBe(true);
			const geometry = await tableWrap.evaluate((element) => ({
				clientHeight: element.clientHeight,
				scrollHeight: element.scrollHeight,
				clientWidth: element.clientWidth,
				scrollWidth: element.scrollWidth,
			}));
			expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
			expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
			await page.waitForTimeout(250);
			await page.screenshot({
				path: testInfo.outputPath("100-targets-360px.png"),
			});
			await tableWrap.focus();
			await expect(tableWrap).toBeFocused();
			await page.keyboard.press("PageDown");
			if ((await tableWrap.evaluate((element) => element.scrollTop)) === 0)
				await page.keyboard.press("ArrowDown");
			expect(
				await tableWrap.evaluate((element) => element.scrollTop),
			).toBeGreaterThan(0);
			await dialog.getByRole("row").last().scrollIntoViewIfNeeded();
			await expect(cancel).toBeVisible();
			await expect(
				dialog.getByText(
					locale === "ja"
						? "本文・画像・履歴は保持され、アーカイブ一覧から復元できます。"
						: "Descriptions, images, and history are kept. You can restore tasks from the archive.",
				),
			).toBeVisible();
			await page.keyboard.press("Escape");
			await expect(dialog).toHaveCount(0);
			await expect(trigger).toBeFocused();
		});
	}
}

test("bulk archive Pen baseline shows two fixed tasks and retention copy", async ({
	page,
}, testInfo) => {
	resetBoard(mainProject);
	await page.setViewportSize({ width: 1280, height: 900 });
	await setPreferences({ locale: "ja", theme: { mode: "light", accent: "blue" } });
	await page.goto("/");
	await page.getByRole("button", { name: /Initialize the board/ }).click();
	const trigger = page.locator(".lane-header__archive");
	await trigger.click();
	const dialog = page.getByRole("dialog");
	await expect(dialog.getByRole("row")).toHaveCount(3);
	const rows = dialog.getByRole("row");
	await expect(rows.nth(1).locator("td")).toHaveText([
		"#9",
		"Return the task list as JSON",
		"AI",
	]);
	await expect(rows.nth(2).locator("td")).toHaveText([
		"#8",
		"Initialize the board",
		"AI",
	]);
	await expect(
		dialog.getByText("agent-board の完了タスク2件をアーカイブします。"),
	).toBeVisible();
	await expect(
		dialog.getByText(
			"本文・画像・履歴は保持され、アーカイブ一覧から復元できます。",
		),
	).toBeVisible();
	await expect(dialog.locator('[data-slot="dialog-close"]')).toHaveCount(0);
	await page.waitForTimeout(250);
	await page.screenshot({
		path: testInfo.outputPath("pen-jNGnc-baseline.png"),
	});
});

test("archive empty state matches the Pen guidance and shared detail placeholder", async ({
	page,
}, testInfo) => {
	resetBoard(mainProject);
	await page.setViewportSize({ width: 1280, height: 900 });
	await setPreferences({ locale: "ja", theme: { mode: "light", accent: "blue" } });
	await page.route("**/api/projects/*/archive", async (route) => {
		const response = await route.fetch();
		await route.fulfill({
			response,
			json: { ...(await response.json()), tasks: [] },
		});
	});
	await page.goto("/");
	await expect(page.getByRole("region", { name: "未着手" })).toBeVisible();
	await page.locator(".header__archive").click();
	await expect(page.locator(".list-pane__count")).toHaveText("0件");
	await expect(page.locator(".list-pane__rows")).toHaveCount(0);
	await expect(page.locator(".list-pane__empty svg")).toBeVisible();
	await expect(
		page.getByText("アーカイブされたタスクはありません"),
	).toBeVisible();
	await expect(
		page.getByText("タスクをアーカイブすると、ここに表示されます。"),
	).toBeVisible();
	await expect(page.locator(".detail__empty-message")).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath("04-archive-empty.png") });
});
