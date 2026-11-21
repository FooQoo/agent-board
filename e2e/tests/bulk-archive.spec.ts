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
