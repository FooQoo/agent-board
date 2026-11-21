import { expect, test } from "../helpers/fixtures";
import { listTasks, mainProject, resetBoard } from "../helpers/agboard";
import { resetPreferences } from "../helpers/preferences";

// #627: the lane header's bulk archive button on the PC board, pressed through to the saved result.
test.beforeEach(() => resetPreferences());
test.afterEach(() => resetPreferences());

const doneIds = () =>
	listTasks(mainProject)
		.filter((task) => task.taskStatus === "done" && !(task as { archivedAt?: string | null }).archivedAt)
		.map((task) => task.id);

test("the PC board's bulk archive button archives the done cards and the board updates", async ({
	page,
}) => {
	resetBoard(mainProject);
	const targets = doneIds();
	expect(targets.length).toBeGreaterThan(0);
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto("/");
	const trigger = page.locator(".lane-header__archive");
	await expect(trigger).toBeEnabled();
	await trigger.click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible();
	// Cancel first: the button must open the confirmation again, and nothing is archived.
	await dialog.getByRole("button", { name: /cancel|キャンセル/i }).click();
	await expect(dialog).toHaveCount(0);
	expect(doneIds()).toEqual(targets);
	await trigger.click();
	await dialog
		.getByRole("button", { name: new RegExp(`archive ${targets.length} tasks|${targets.length}件をアーカイブ`, "i") })
		.click();
	await expect(dialog).toHaveCount(0);
	await expect.poll(doneIds).toEqual([]);
	await expect(page.locator(".lane-header__archive")).toBeDisabled();
});

// #628: below 768px the same board shows the phone screen. Its Archive all button, pressed in a narrow desktop
// window, must open the confirmation, cancel without a change, and archive the cards when confirmed.
for (const width of [767, 360]) {
	test(`the phone screen's Archive all button archives the done cards in a ${width}px window`, async ({
		page,
	}) => {
		resetBoard(mainProject);
		const targets = doneIds();
		expect(targets.length).toBeGreaterThan(0);
		await page.setViewportSize({ width, height: 800 });
		await page.goto("/");
		await expect(page.getByRole("tablist", { name: "Lanes" })).toBeVisible();
		await page.getByRole("tab", { name: /^Done / }).click();
		const trigger = page.getByRole("button", { name: "Archive all" });
		await expect(trigger).toBeEnabled();
		await trigger.click();
		const dialog = page.getByRole("dialog", { name: "Archive completed tasks" });
		await expect(dialog).toBeVisible();
		await dialog.getByRole("button", { name: "Cancel" }).click();
		await expect(dialog).toHaveCount(0);
		expect(doneIds()).toEqual(targets);
		// The button answers again after the cancel, and the confirmation archives every target.
		await trigger.click();
		await dialog.getByRole("button", { name: `Archive ${targets.length} tasks` }).click();
		await expect(dialog).toHaveCount(0);
		await expect.poll(doneIds).toEqual([]);
		await expect(page.getByRole("tab", { name: "Done 0" })).toBeVisible();
		await expect(trigger).toHaveCount(0);
	});
}
