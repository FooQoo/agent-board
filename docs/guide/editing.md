---
title: Editing and evidence
---

# Editing and evidence

Cards and epics are written in a Markdown editor. Card completion conditions sit in a panel below the text, and images and text evidence can be attached to a card. Agents edit the same content as plain files in the project's shared folder.

## Write cards and plans in the editor

![The card editor with a table of contents, a Mermaid diagram, task list, and the acceptance panel expanded](../images/guide/editor.png){.screenshot}

The editor shows the outline on the left, the Markdown body in the middle, and the epic and image attachments on the right. In the card editor, the acceptance conditions panel is fixed below the body, so the body scrolls on its own.

Card creation and card editing keep acceptance conditions in that panel. It starts folded. Expand it to edit conditions; a long list scrolls inside the panel, with its height limited to leave the body accessible. Conditions have stable IDs and cannot be reordered. Use the outline to jump to a body heading or open the conditions panel. In card details, read conditions in the separate Conditions tab. Epic reference conditions are ordinary Markdown in the plan body, without a separate conditions panel.

The Markdown editor supports headings, task lists, tables, code blocks, Mermaid diagrams, and images. Save or cancel the dialog's changes together. Keep the required [shared Markdown format](#edit-shared-markdown-files), and record verification before checking off a completion condition. Click an image or Mermaid diagram to enlarge it.

For the epic dialog (name, color, plan, and task order), see [Epics and progress](./epics). For drafts, see [The board](./board).

## Add images and evidence

Use the browser editor to select, drop, or paste an image, then insert it into the card text. Image attachments support PNG, JPEG, WebP, and GIF. With the CLI:

```sh
agboard --project "My project" attachment add 1 --file diagram.png --actor ai
agboard --project "My project" attachment ls 1 --json
agboard --project "My project" attachment get 1 "<attachment-id>" --output diagram-copy.png
```

Images use persistent `attachment:<attachment-id>` references in card Markdown. Snapshots include attachment metadata; progress tables and hooks omit it. Image bytes stay in local files. `attachment get` never overwrites an existing output file.

Add a UTF-8 log or other text as evidence, then use the returned evidence ID to read it:

```sh
agboard --project "My project" evidence add 1 test-output.log
agboard --project "My project" evidence show 1 "<evidence-id>"
```

## Edit shared Markdown files

Find the project's files instead of assuming their location:

```sh
agboard --project "My project" workspace --json
```

The result contains `folder` (the project's absolute path), `projectId`, `readme`, `tasks`, and `epics`. Read the project's `README.md` before editing files.

Agents may edit a non-draft card's `TASK.md` and an epic's `PLAN.md` as that README allows. For direct edits, write a temporary file in the same folder and rename it over the original. The board follows file changes automatically. Use the CLI for metadata and status changes; never edit `task.json`, `epic.json`, `project.json`, or `.internal/` lock files directly, or delete card or epic folders directly. Keep personal absolute paths out of shared files.

### TASK history and acceptance frontmatter

`task.json` contains card metadata such as its current lane and owner and uses format version 2. It does not contain history. `TASK.md` is the source of truth for the card's body, acceptance conditions, and operation history. PLAN.md uses priority metadata for task order; epic reference conditions belong directly in its Markdown body.

TASK.md holds its completion conditions in YAML frontmatter at the top of the file. The body after it is free Markdown; no heading is required. New card input may omit `history` or use an empty list; Agent Board adds the initial `created` event when it creates the card:

```markdown
---
acceptance:
  - id: AC-1
    text: The setup guide covers the supported installation steps.
    done: false
  - id: AC-2
    text: Deleting a card asks for confirmation.
    done: true
history: []
---

## Background

Any headings and text you need.
```

Each condition has three keys: `id` (`AC-` followed by a positive number without a leading zero, unique in the file), `text` (1 to 2,000 characters after trimming), and `done` (`true` or `false`). Other keys in the frontmatter are kept when the board writes the file. A PLAN.md without frontmatter is entirely body text. Epic reference conditions are written there as ordinary Markdown and are not parsed as acceptance data. A format version 2 `TASK.md` must have a valid top-level `history` list, even when its `acceptance` list is empty.

Agent Board appends operation history to TASK.md when card operations occur, including lane and agent-state changes, questions and answers, and archive or restore actions. UI status changes are written to the same Markdown history shown in the card's History tab. Ordinary body and acceptance edits preserve the latest history; history is not an input to those edits. Use the history shown by the board or returned by `show`/`snapshot` for operation history. Keep detailed work notes and evidence references in the free-Markdown body.

If the frontmatter cannot be read (invalid YAML, a missing key, a duplicate ID, an empty text), the board reports the file, the item, and the reason as a problem. The card then shows no progress and its body is shown in full. The board never rewrites the file to fix it.

### Checking conditions and automatic Done

Mark a condition `done: true` only after you have verified it, and record the result and evidence in the body (for example in an execution log section). While `agboard serve` is running, a non-draft, unarchived AI-owned Todo or Doing card with at least one valid condition moves to Done automatically once all conditions are done. The server also checks existing cards at startup. Pending cards wait until answered; human-owned cards, drafts, invalid acceptance data, and empty condition lists do not auto-complete. Reopening a card without unchecking a condition can cause it to complete again. Epic reference conditions are plain plan text and are not managed by the app.

### Epic priority

An epic's frontmatter can contain a `priority` list of distinct positive card IDs. It controls the epic progress panel and CLI progress order, independently of board lane order:

```yaml
priority: [3, 1, 2]
```

New cards start with an empty `acceptance` list; new epics start with an empty Markdown plan. New cards use task format version 2. This version does not read or migrate version 1 task files; it reports them as unsupported and leaves them unchanged. When adopting this version for an existing board, the user must remove the old data before starting with new cards. Agent Board never deletes or resets old data automatically. A task file paired with version 1 metadata is unsupported regardless of whether it uses older headings such as `## Work` or `## 作業内容`; it is not converted. Legacy acceptance keys in PLAN.md remain opaque metadata; no condition conversion is performed.
