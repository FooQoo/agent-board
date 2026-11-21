import { expect, test } from "../helpers/fixtures";
import { agboardOk, listTasks, mainProject, nextTaskId, resetBoard } from "../helpers/agboard";
import { resetPreferences } from "../helpers/preferences";

// #634: the Backlog lane and the send-to-Todo operation, from the PC board and from the phone screen.
test.beforeEach(() => resetPreferences());
test.afterEach(() => resetPreferences());

const laneOf = (id: number) => listTasks(mainProject).find((task) => task.id === id)?.taskStatus;

/** Three plans in the Backlog; the second has an open question. */
function seedBacklog() {
	resetBoard(mainProject);
	const first = nextTaskId(mainProject);
	const ids = [first, first + 1, first + 2];
	for (const [index, id] of ids.entries()) {
		agboardOk(mainProject, ["add", `Backlog plan ${index + 1}`, "--assignee", "ai", "--actor", "ai", "--backlog"]);
		expect(laneOf(id)).toBe("backlog");
	}
	agboardOk(mainProject, [
		"message", "ask", "--actor", "ai", "--no-wait", "--task", String(ids[1]), "--questions-json",
		JSON.stringify({ questions: [{ body: "Which release name should the plan use?" }] }),
	]);
	return ids;
}

test("the PC board shows the Backlog lane and sends the picked cards to Todo", async ({ page }) => {
	const [a, b, c] = seedBacklog();
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto("/");
	const backlog = page.getByRole("region", { name: "Backlog" });
	await expect(backlog.locator(".lane-header__count")).toHaveText("3");
	await expect(backlog.getByText("Open question")).toBeVisible();
	await expect(page.getByText(/AI draft/i)).toHaveCount(0);

	// The lane header's button starts the selection mode; the bar sends the picked cards with a notice of the result.
	await backlog.getByRole("button", { name: "Select cards to send to Todo" }).click();
	await backlog.getByRole("checkbox", { name: `Select #${a}` }).click();
	await backlog.getByRole("checkbox", { name: `Select #${c}` }).click();
	await expect(backlog.getByText("2 selected")).toBeVisible();
	await backlog.getByRole("button", { name: "Send to Todo (2)" }).click();
	await expect(page.getByRole("status").filter({ hasText: "Sent 2 cards to Todo." })).toBeVisible();
	await expect.poll(() => [laneOf(a), laneOf(b), laneOf(c)]).toEqual(["todo", "backlog", "todo"]);
	await expect(backlog.locator(".lane-header__count")).toHaveText("1");
});

test("a card with an open question is sent only after the warning is confirmed", async ({ page }) => {
	const [, b] = seedBacklog();
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto("/");
	const backlog = page.getByRole("region", { name: "Backlog" });
	// The board reads the question through the server's index, which can lag the CLI by a moment.
	await expect(backlog.getByText("Open question")).toBeVisible();
	await backlog.getByRole("button", { name: "Select cards to send to Todo" }).click();
	await backlog.getByRole("checkbox", { name: `Select #${b}` }).click();
	await backlog.getByRole("button", { name: "Send to Todo (1)" }).click();
	const dialog = page.getByRole("dialog", { name: "Send to Todo" });
	await expect(dialog.getByRole("alert")).toContainText(`#${b}`);
	const send = dialog.getByRole("button", { name: "Send to Todo" });
	await expect(send).toBeDisabled();
	// Cancelling changes nothing, and the selection stays.
	await dialog.getByRole("button", { name: "Cancel" }).click();
	expect(laneOf(b)).toBe("backlog");
	await expect(backlog.getByRole("checkbox", { name: `Select #${b}` })).toBeChecked();
	await backlog.getByRole("button", { name: "Send to Todo (1)" }).click();
	await dialog.getByRole("checkbox").check();
	await send.click();
	await expect(page.getByRole("status").filter({ hasText: "Sent 1 card to Todo." })).toBeVisible();
	await expect.poll(() => laneOf(b)).toBe("todo");
});

test("the picked cards are grabbed together and dropped on the Todo lane", async ({ page }) => {
	const [a, , c] = seedBacklog();
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto("/");
	const backlog = page.getByRole("region", { name: "Backlog" });
	await backlog.getByRole("button", { name: "Select cards to send to Todo" }).click();
	await backlog.getByRole("checkbox", { name: `Select #${a}` }).click();
	await backlog.getByRole("checkbox", { name: `Select #${c}` }).click();
	const source = await backlog.getByRole("button", { name: /Backlog plan 1/ }).boundingBox();
	const target = await page.getByRole("region", { name: "Todo" }).boundingBox();
	if (!source || !target) throw new Error("The lanes are not laid out.");
	await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
	await page.mouse.down();
	await page.mouse.move(source.x + source.width / 2 + 20, source.y + source.height / 2 + 20, { steps: 5 });
	await page.mouse.move(target.x + target.width / 2, target.y + 200, { steps: 15 });
	await page.mouse.up();
	await expect.poll(() => [laneOf(a), laneOf(c)]).toEqual(["todo", "todo"]);
});

test("the card details say Backlog and send the plan to Todo", async ({ page }) => {
	const [a] = seedBacklog();
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto("/");
	await page.getByRole("region", { name: "Backlog" }).getByRole("button", { name: /Backlog plan 1/ }).click();
	const detail = page.getByRole("complementary").filter({ hasText: "Backlog plan 1" });
	await expect(detail.getByText("not started yet", { exact: false })).toBeVisible();
	await detail.getByRole("button", { name: "Send to Todo" }).click();
	await expect.poll(() => laneOf(a)).toBe("todo");
});

for (const width of [767, 390]) {
	test(`the phone screen sends the picked Backlog cards to Todo in a ${width}px window`, async ({ page }) => {
		const [a, b, c] = seedBacklog();
		await page.setViewportSize({ width, height: 800 });
		await page.goto("/");
		await expect(page.getByRole("tab", { name: "Backlog 3" })).toBeVisible();
		await page.getByRole("tab", { name: "Backlog 3" }).click();
		await expect(page.getByText("Open question")).toBeVisible();
		await page.getByRole("button", { name: "Select cards" }).click();
		await page.getByRole("checkbox", { name: `Select #${a}` }).click();
		await page.getByRole("checkbox", { name: `Select #${b}` }).click();
		const bar = page.getByRole("region", { name: "Send selected cards" });
		await expect(bar.getByText("2 selected")).toBeVisible();
		// Both buttons of the bar have the same width.
		const [cancel, send] = await Promise.all([
			bar.getByRole("button", { name: "Cancel" }).boundingBox(),
			bar.getByRole("button", { name: "Send to Todo (2)" }).boundingBox(),
		]);
		expect(Math.abs((cancel?.width ?? 0) - (send?.width ?? 1))).toBeLessThan(2);
		// #b has an open question: the sheet names it, and sending waits for the check.
		await bar.getByRole("button", { name: "Send to Todo (2)" }).click();
		const sheet = page.getByRole("dialog", { name: "Send to Todo" });
		await expect(sheet.getByRole("alert")).toContainText(`#${b}`);
		await sheet.getByRole("checkbox").check();
		await sheet.getByRole("button", { name: "Send to Todo" }).click();
		await expect(page.getByRole("status").filter({ hasText: "Sent 2 cards to Todo." })).toBeVisible();
		await expect.poll(() => [laneOf(a), laneOf(b), laneOf(c)]).toEqual(["todo", "todo", "backlog"]);
		await expect(page.getByRole("tab", { name: "Backlog 1" })).toBeVisible();
	});
}
