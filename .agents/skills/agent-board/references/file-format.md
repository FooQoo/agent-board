# TASK.md and PLAN.md format

**All task progress and operation history lives only in the top-level `history` YAML frontmatter of `TASK.md`.** Each entry has exactly two keys: `at` (timestamp) and `reason` (content). Do not store chronological history in the Markdown body, an execution log section, or `task.json`.

The completion conditions of a card (`TASK.md`) are in `acceptance` frontmatter and the board reads them. The body holds the task plan, acceptance verification results, and artifact or evidence references; no heading is required. Full logs belong in evidence files. `PLAN.md` has no history. Its reference conditions remain ordinary Markdown in its body, without acceptance frontmatter or a separate conditions editor. It may use priority frontmatter for task order.

Start from [assets/TASK.md](../assets/TASK.md) or [assets/PLAN.md](../assets/PLAN.md).

## The frontmatter

This is creation input; the board generates the initial history entry when it creates the card:

```markdown
---
acceptance:
  - id: AC-1
    text: The setup guide covers the supported installation steps.
    done: false
history: []
---
```

- `acceptance`: a list. Each item has three keys and no others:
  - `id`: `AC-` followed by a positive number without a leading zero. Unique in the file.
  - `text`: one to 2,000 characters after trimming. Write it so that it can be verified.
  - `done`: `true` or `false`.
- `history`: a required top-level list in stored format version 3 task files. An empty list is valid, even when `acceptance` is empty. New-card input may omit it or supply `history: []`; created cards get a generated initial entry.
- A `PLAN.md` may have `priority: [3, 1, 2]`: distinct positive card IDs in work order. Unlisted epic members follow in ascending ID order. Change it in the epic progress panel, with `epic edit --priority`, or by editing PLAN.md. This is independent of lane order.
- Other frontmatter keys are preserved when the board writes the file. A `PLAN.md` without frontmatter is entirely body text; its reference conditions are not parsed by the app.

## Task history

The following is an illustrative stored entry, not a note to copy into a new task template:

```yaml
history:
  - at: "2026-10-15T01:30:00Z"
    reason: "Verified the setup guide links and saved the build output as evidence."
```

`at` is an RFC3339 timestamp; the example uses UTC. `reason` is concise content (up to 2,000 characters). Entries have no ID, kind, actor, or transition fields. API and CLI responses return history in this same two-field shape. Question and answer lookup data is separate from history.

Agent Board appends history automatically for card operations, including UI or CLI lane and state changes, questions and answers, and archive or restore actions. Missing or blank reasons generate wording from the current state. The browser's reason field is optional.

Agents automatically record meaningful work progress with:

```sh
agboard --project "<name>" history add <id> --reason "<actual work and verification outcome>"
agboard --project "<name>" history add <id> --reason-file <path>
```

The timestamp is automatic and AI write permissions apply. Omitting or blanking the reason generates state-aware wording. Do not manually duplicate the history already added by a lane or state change. AI history writes are forbidden for drafts, archived cards, and Done cards. Prefer the CLI for atomic appends and timestamps. Direct Markdown appends may add entries with only `at` and `reason` while preserving current history, the body, acceptance conditions, and unknown metadata; do not replace the whole file solely to append history.

Ordinary body and acceptance edits preserve the latest history; `edit --desc-file` is not a history append operation. Read history in the board or with `show`/`snapshot`.

## Format versions

New cards use `task.json` format version 3. It stores card metadata such as the lane and owner, without history. Other shared JSON files remain format version 1. Task versions 1 and 2 are unsupported, regardless of their Markdown shape: they are reported as unsupported and left unchanged. There is no migration, fallback, or automatic deletion. Legacy acceptance keys in `PLAN.md` remain opaque metadata, without conversion or managed condition behavior.

If frontmatter cannot be read, the board reports the file, item, and reason as a problem. The card then shows no progress and its whole text is the body. Fix the file by hand; the board does not rewrite it.

## Rules

- Set `done: true` only after verification succeeds. Keep the result and evidence references in the body, and record the verification in history before saving the final completed condition.
- Add a condition with the next free number. Do not renumber items.
- When every condition is `done: true`, the board automatically moves an eligible AI-owned, non-draft Todo/Doing card to Done. Pending questions remain open until answered. Do not manually move an AI card to Done in the normal work loop; people can still move cards themselves.
- Keep task plans, verified results, and references in the body; keep all chronological progress and operation history only in the `history` frontmatter.
