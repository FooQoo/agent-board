# TASK.md and PLAN.md format

The completion conditions of a card (TASK.md) are in YAML frontmatter. The board reads them. Epic reference conditions are ordinary Markdown in the PLAN.md body, without acceptance frontmatter or a separate conditions editor. The body after the frontmatter is free Markdown, and no heading is required. Only TASK.md has an operation-history field. PLAN.md may use priority frontmatter for task order.

Start from [assets/TASK.md](../assets/TASK.md) or [assets/PLAN.md](../assets/PLAN.md).

## The frontmatter

```markdown
---
acceptance:
  - id: AC-1
    text: The setup guide covers the supported installation steps.
    done: false
---
```

- `acceptance`: a list. Each item has three keys and no others:
  - `id`: `AC-` followed by a positive number without a leading zero. Unique in the file.
  - `text`: one to 2,000 characters after trimming. Write it so that it can be verified.
  - `done`: `true` or `false`.
- A PLAN.md may have `priority: [3, 1, 2]`: distinct positive card IDs in work order. Unlisted epic members follow in ascending ID order. Change it in the epic progress panel, with `epic edit --priority`, or by editing PLAN.md. This is independent of lane order.
- Other keys in the frontmatter are kept when the board writes the file.
- A `PLAN.md` without frontmatter is entirely body text. Its reference conditions are not parsed by the app. A format version 2 `TASK.md` must have a valid top-level `history` list, even when its `acceptance` list is empty.

## TASK operation history

New cards use `task.json` format version 2. It stores card metadata such as the current lane and owner, but no history array. TASK.md stores the body, acceptance conditions, and the complete operation history in its top-level `history` list. New-card input may omit `history` or set it to an empty list; Agent Board creates the initial `created` event. Do not copy history into the body or send it as part of ordinary edits.

Agent Board appends operation events to TASK.md when card operations occur, including status changes made in the UI or CLI. Ordinary body and acceptance edits preserve the latest history. Read the history in the board or with `show`/`snapshot`; use the detailed execution-log section of the body for work notes and evidence references.

This version reads only task format version 2. It does not migrate or fall back to version 1. Agent Board never deletes old data automatically. When starting with this version from an existing board, the user must remove the old data and begin with new cards.

If the frontmatter cannot be read, the board reports the file, the item, and the reason as a problem. The card then shows no progress and its whole text is the body. Fix the file by hand; the board does not rewrite it.

## Rules

- Set `done: true` only after the verification succeeded. Record the result and the evidence in the body, for example in the execution log.
- Add a condition with the next free number. Do not renumber the items.
- When every condition is `done: true`, the board automatically moves an eligible AI-owned, non-draft Todo/Doing card to Done. Pending questions remain open until answered. Do not manually move an AI card to Done in the normal work loop; people can still move cards themselves.
- Keep results and notes in the body, not in the frontmatter.

## Earlier files

Task files paired with `task.json` format version 1 are unsupported by this version, regardless of their Markdown shape. They are reported as unsupported and are not converted. Do not describe them as readable body-only cards. PLAN.md interprets only priority metadata; legacy acceptance keys are kept as opaque metadata, without conversion or managed condition behavior.
