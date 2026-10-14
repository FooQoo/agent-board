---
title: Epics and progress
---

# Epics and progress

## Organize work with epics

```sh
agboard --project "My project" epic add launch --name "Website launch" --actor ai
agboard --project "My project" epic ls --json
agboard --project "My project" epic show LAUNCH --json
agboard --project "My project" epic edit LAUNCH --plan-file plan.md
agboard --project "My project" edit 1 --epic LAUNCH
agboard --project "My project" add "Prepare the preview" --assignee ai --actor ai --epic LAUNCH
agboard --project "My project" edit 1 --clear-epic
```

Epic IDs use letters, digits, and hyphens; lowercase input is normalized to uppercase. The plan is free Markdown with optional acceptance and priority frontmatter; no heading is required. Use `--name` or `--color '#7C3AED'` with `epic edit` to change the name or color. A card belongs to at most one epic.

Save an epic's task order from the CLI:

```sh
agboard --project "My project" epic edit LAUNCH --priority "3,1,2"
```

This writes `priority: [3, 1, 2]` in `PLAN.md`. Entries must be distinct positive card IDs; only current members of the epic are retained. Unlisted members follow in ascending ID order. Pass `--priority ""` to clear the explicit order. The epic dialog's progress panel includes completed tasks for review, while the CLI progress table omits them.

## Edit an epic in the browser

Open an epic from its label to edit its name, color, plan, acceptance conditions, and task order. The right column starts with progress expanded and attachments folded. Opening either panel folds the other. The progress list scrolls independently, so long lists stay inside the dialog. Drag a task by its handle, or use the handle's keyboard controls, then Save to apply the order. Selecting a task opens its details. Change membership in the card editor or CLI, rather than through membership checkboxes in the epic dialog. Each card belongs to at most one epic. The epic dialog has no Draft checkbox and preserves the epic's existing draft state.

![Epic editor with a scrollable task progress panel and folded acceptance conditions](../images/epic.png){.screenshot}

The epic editor shows the outline on the left, the name and plan in the middle, and the label, task progress list, and attachments on the right. Acceptance conditions stay folded at the bottom until you expand them.

## Read the progress table

```sh
agboard progress
agboard progress --json
agboard --project "My project" progress --json
```

The table groups Todo and Doing cards under their epics, with a separate group for work without an epic. Done, archived, and Pending cards are omitted. Pending questions remain on the board until answered; use `show` or `snapshot` to inspect them. Human-owned and draft cards remain in progress for context, but agents must skip them when choosing work.

Each entry includes the card ID, title, owner, lane, agent state, acceptance counts, and its `taskPath`. Epic entries include `planPath`. Bodies, history, and image bytes are omitted: read only the files needed for the selected work. Hooks supply this same table.

Epics appear in ID order. Within an epic, the `priority` list in `PLAN.md` determines task order; IDs not listed follow in ascending card-ID order. Work without an epic is also sorted by card ID. This order is independent of lane positions. Epics with no listed cards are omitted.
