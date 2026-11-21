import { expect, test } from "../helpers/fixtures";
import { mainProject, resetBoard } from "../helpers/agboard";
import { resetPreferences } from "../helpers/preferences";

// #660: the archive list is ordered by archive time, newest first, on the PC screen. The phone's list is covered in monitor-lanes.spec.ts.
test.beforeEach(() => resetPreferences());
test.afterEach(() => resetPreferences());

// Deliberately out of order. Expected: 4 (newest), 5 and 2 (same time, higher id first), 1, then 3 (no time).
const archived = [
	{ id: 1, archivedAt: "2026-10-01T09:00:00Z" },
	{ id: 2, archivedAt: "2026-10-02T09:00:00Z" },
	{ id: 3, archivedAt: null },
	{ id: 4, archivedAt: "2026-10-03T09:00:00Z" },
	{ id: 5, archivedAt: "2026-10-02T09:00:00Z" },
];
const expected = [4, 5, 2, 1, 3];

async function stubArchive(page: import("@playwright/test").Page) {
	await page.route("**/api/projects/*/archive?*", async (route) => {
		const summaryUrl = route.request().url().replace(/\/archive\?.*$/, "/summary");
		const summary = await (await page.request.get(summaryUrl)).json();
		const base = summary.tasks[0];
		await route.fulfill({
			json: {
				...summary,
				total: archived.length,
				nextCursor: null,
				tasks: archived.map(({ id, archivedAt }) => ({
					...base,
					id,
					title: `Archived task ${id}`,
					archivedAt,
					attachments: [],
					acceptance: [],
				})),
			},
		});
	});
}

test("the PC archive list shows the newest archive first", async ({ page }) => {
	resetBoard(mainProject);
	await stubArchive(page);
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto("/");
	await page.locator(".header__archive").click();
	await expect(page.locator(".archive-row")).toHaveCount(archived.length);
	const ids = await page.locator(".archive-row__id").allTextContents();
	expect(ids).toEqual(expected.map((id) => `#${id}`));
});
