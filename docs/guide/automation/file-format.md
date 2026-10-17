---
title: Markdown file format
---

# Markdown file format

Each task is a `TASK.md` file and each epic is a `PLAN.md` file. Agents and people may edit them directly; the board follows the changes. This page describes what the files must contain. To find them, see [Edit the files directly](../use/editing#edit-the-files-directly).

| File | Holds | Edit it? |
| --- | --- | --- |
| `TASK.md` | The task's body, acceptance conditions, and history. | Yes, unless the task is a draft. |
| `PLAN.md` | The epic's plan and the order of its tasks. | Yes. |
| `task.json`, `epic.json`, `project.json` | State and metadata. | No. Use the CLI. |

## TASK.md

A `TASK.md` starts with YAML frontmatter between two `---` lines, then the body in free Markdown:

```markdown
---
acceptance:
  - id: AC-1
    text: The setup guide covers the supported installation steps.
    done: false
  - id: AC-2
    text: Deleting a task asks for confirmation.
    done: true
history: []
---

## Background

Any headings and text you need.
```

- **Body.** The body holds the task plan, the results of checking each acceptance condition, and references to artifacts and evidence. No heading is required. Do not put a chronological log in the body; the history belongs in the frontmatter, and full logs belong in [evidence files](../use/editing#add-evidence).
- **New tasks.** When you create a task, `history` may be omitted or empty; Agent Board adds the first history entry. A stored `TASK.md` must have a valid top-level `history` list, even when `acceptance` is empty.

### Acceptance conditions

`acceptance` is a list. Each item has three keys and no others:

| Key | Rule |
| --- | --- |
| `id` | `AC-` followed by a positive number without a leading zero. Unique in the file. |
| `text` | 1 to 2,000 characters after trimming. Write it so that it can be verified. |
| `done` | `true` or `false`. |

Add a condition with the next free number; do not renumber. Other keys in the frontmatter are kept when the board writes the file.

### History

`history` lists what happened, oldest first. Each entry has exactly two keys:

```yaml
history:
  - at: "2026-10-15T01:30:00Z"
    reason: "Verified the setup guide links and saved the build output as evidence."
```

- `at` is a UTC string in the exact form `YYYY-MM-DDTHH:MM:SSZ`, with whole seconds and an uppercase `Z`. Offsets (including `+00:00`) and fractional seconds are rejected.
- `reason` is the content, up to 10,000 characters.
- The list may be empty in a stored file. The API and the CLI return history in the same `at`/`reason` shape.

Agent Board adds an entry whenever an operation happens: a move, a state change, a question and its answer, archiving and restoring, and automatic completion. The browser's reason field is optional; a missing or blank reason is generated from the current state. The History tab, `show`, and `snapshot` all read the same history.

Agents add meaningful progress with [`history add`](./cli#report-work), without asking for approval each time. Moves and state changes already record themselves, so do not add a duplicate. The command assigns the timestamp, appends atomically, and applies AI write permissions: an AI cannot append to drafts, archived tasks, or Done tasks. A direct edit may append entries that have only `at` and `reason` and must keep the existing history, body, conditions, and other metadata; do not rewrite the whole file just to append history. Ordinary body and condition edits keep the latest history, and `edit --desc-file` ignores any history in its input.

### Check conditions and finish

Mark a condition `done: true` only after you have verified it. Keep the result and the evidence references in the body, and record the verification in the history before you save the last completed condition.

While `agboard serve` is running, a task finishes by itself when it is:

- AI-owned, not a draft, not archived, and in Todo or Doing;
- carrying at least one valid condition, with every condition `done: true`.

The server also checks existing tasks when it starts. Pending tasks wait until they are answered. User-owned tasks, drafts, tasks with invalid conditions, and tasks with no conditions do not finish automatically. A Done task is read-only for agents and never reopens by itself. If you reopen one without unchecking a condition, it can finish again.

## PLAN.md

A `PLAN.md` is the epic's plan in free Markdown. Write the epic's reference completion conditions directly in the body as ordinary Markdown; they are not parsed as acceptance data, and an epic has no history.

Its frontmatter may hold a `priority` list of distinct positive task IDs. It sets the order in the epic's progress panel and in the CLI progress table, independently of the board columns:

```yaml
priority: [3, 1, 2]
```

A `PLAN.md` without frontmatter is entirely body text. Save the order from the CLI with `epic edit --priority`, in the progress panel, or by editing the file. Legacy `acceptance` keys in a `PLAN.md` are kept as opaque metadata and are not converted.

## When a file is invalid

If the frontmatter cannot be read (invalid YAML, a missing key, a duplicate ID, an empty text), the board reports the file, the item, and the reason as a problem. The task then shows no progress and its text is shown in full as the body. The board never rewrites the file to fix it; fix it by hand and the next read shows it normally.

Every JSON file declares `formatVersion: 1`. A file with any other version is unsupported: the board reports it and leaves it unchanged, with no migration, fallback, deletion, or reset.

## Next

- [Troubleshooting](../operations/troubleshooting): a task missing from the board or a warning about a file.
- [CLI reference](./cli): the commands that change these files for you.
