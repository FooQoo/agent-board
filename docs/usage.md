# Agent Board usage guide

Agent Board is a local work board shared by users and AI agents. Each project has its own cards, epics, and history. Use the browser for reviewing and editing work, and `agboard` for agent updates and project management.

[README](../README.md) · [Mobile monitor](mobile-monitor.md) · [Claude Code and Codex integration](../integrations/README.md) · [Contributing](../CONTRIBUTING.md)

- [Installation and updates](#installation-and-updates)
- [Start a project](#start-a-project)
- [Use the browser](#use-the-browser)
- [Use the CLI](#use-the-cli)
- [Read the progress table](#read-the-progress-table)
- [Ask and answer decisions](#ask-and-answer-decisions)
- [Organize work with epics](#organize-work-with-epics)
- [Add images and evidence](#add-images-and-evidence)
- [Workflow for agents](#workflow-for-agents)
- [Edit shared Markdown files](#edit-shared-markdown-files)
- [Data and backups](#data-and-backups)

## Installation and updates

Follow [Install in the README](../README.md#install) to build the web UI and install `agboard`. The prerequisites are Git, Rust with edition 2024 support, Node.js, and pnpm.

The installed command lives in `~/.cargo/bin`, or `$CARGO_HOME/bin` when `CARGO_HOME` is set. Check that your shell can find it:

```sh
command -v agboard
agboard --help
```

In PowerShell, use `Get-Command agboard`. If the command cannot be found, add Cargo's `bin` directory to your shell's `PATH` and open a new shell. For a default macOS installation, add `export PATH="$HOME/.cargo/bin:$PATH"` to your shell profile.

After pulling repository changes, rebuild and reinstall from the repository root:

```sh
pnpm --dir web install
pnpm --dir web build
cargo install --path . --locked --force
```

The CLI embeds the built web UI, so build the web UI first. `--force` replaces the installed version. Stop and restart `agboard serve` after an update to use the new executable and UI.

Hooks and the agent skill run `agboard` from `PATH`. A development build (`cargo build`, `cargo run`, or `target/debug/agboard`) is a separate executable; reinstall to make those changes available to hooks.

## Start a project

```sh
agboard project create "My project"
agboard serve --port 7420
```

Open [http://127.0.0.1:7420/](http://127.0.0.1:7420/) and select the project in the header. Keep the server running while using the browser or waiting for board changes. Press Ctrl+C in its terminal to stop it. The server listens only on `127.0.0.1`; choose another port with `--port` if needed.

Project creation, renaming, and deletion are CLI operations:

```sh
agboard project ls --json
agboard --project "My project" project rename "Website launch"
```

A rename preserves the project's ID, folder bindings, and cards. Update the name in commands that pass `--project` explicitly; folder-based progress and hooks continue to resolve the same project. `project rm` deletes the named project and its cards, asks for human confirmation, and is unavailable to agents.

Most commands take an explicit `--project NAME`. `agboard progress` and hooks resolve the nearest registered project folder; an explicit `--project` overrides that binding. Other commands do not infer a project from the browser or another agent.

The examples below use `My project`; substitute your actual project name and the IDs returned by the CLI.

`project create` also binds the project to the current working folder. Use `--folder` for another existing folder, or `project bind` for an existing project:

```sh
agboard project create "Website launch" --folder ./website
agboard project bind "My project"
agboard project bind "My project" --folder ./docs
```

A folder belongs to one project; several folders can belong to the same project. Commands in subfolders use the nearest registered ancestor. A missing or broken binding returns an error instead of guessing another project. Bindings are local settings, separate from the portable shared files.

## Use the browser

### Cards and progress

1. Select a project in the header and choose **Add card**.
2. Enter the title, choose AI or User as the owner, and write the body. Expand the acceptance panel at the bottom to add completion conditions.
3. Select a card for its **Description**, **Conditions**, **History**, and **Epic** tabs. The Conditions tab includes the card's conditions and its epic's conditions. To edit the card or assign an epic, choose **Make draft**, then open the editor. To move it to another column, drag it there and confirm the reason.

A card's owner is fixed after creation. The columns describe work progress:

| Column | Meaning |
| --- | --- |
| Todo | Work that has not started. |
| Doing | Work in progress. AI-owned cards also show an agent state. |
| Done | Completed work. |

AI-owned cards in Doing show **Idle**, **Running**, or **Pending**. Todo cards can also be Pending when an agent asks a question before starting work. User-owned cards and Done cards are always Idle. Running means the agent is working; Pending means it needs a response. A lane change resets the agent state to Idle and withdraws an open question. Changes and their reasons remain in the history.

### Decisions and drafts

Todo and Doing cards with a current Pending request show the question and answer form on the card. Choose one of the offered options, write a note, or do both, then submit the answer. On the PC board, the card heading still opens its details and the card can still be dragged while the answer form is in use. Moving the card to Done clears the answer input. On the mobile monitor, tap the card to open its Body, Conditions, History, and Epic drawer; swipe horizontally to switch tabs. The answer is recorded and the agent state becomes Idle in its current lane; the agent reads the response before deciding how to resume.

A Pending question has no expiry. It remains available until it is answered or the request is withdrawn or changed. The CLI `wait.timeoutSeconds` option limits that wait command only; it does not expire the question.

Use the **Draft** checkbox when creating a card that agents should leave alone. For an existing card, choose **Make draft** in the detail panel, edit and save its text, then choose **Finalize** when it is ready for an agent. Saving in the card editor keeps its draft state; the editor has no Draft checkbox. Draft cards are read-only for agents, including their `TASK.md` files.

### Plans, editing, and archive

Open an epic from its label to edit its name, color, plan, acceptance conditions, and task order. The right column starts with progress expanded and attachments folded. Opening either panel folds the other. The progress list scrolls independently, so long lists stay inside the dialog. Drag a task by its handle, or use the handle's keyboard controls, then Save to apply the order. Selecting a task opens its details. Change membership in the card editor or CLI, rather than through membership checkboxes in the epic dialog. Each card belongs to at most one epic. The epic dialog has no Draft checkbox and preserves the epic's existing draft state.

Card creation, card editing, and epic editing keep acceptance conditions in a panel fixed below the body's scroll area. It starts folded. Expand it to edit conditions; a long list scrolls inside the panel, with its height limited to leave the body accessible. Conditions have stable IDs and cannot be reordered. Use the outline to jump to a body heading or open the conditions panel. In card details, read conditions in the separate Conditions tab.

The Markdown editor supports headings, task lists, tables, code blocks, Mermaid diagrams, and images. Save or cancel the dialog's changes together. Keep the required [shared Markdown format](#edit-shared-markdown-files), and record verification before checking off a completion condition. Click an image or Mermaid diagram to enlarge it.

Archive an individual card, or select **Archive completed cards** in Done to archive several cards together. Open **Archive** in the header to review archived cards, restore them, or delete them permanently. Permanent deletion in the browser is available from Archive.

### Language and theme

Open **Settings** to choose English or Japanese and one of 24 themes (12 colors, each in light and dark). Changes apply immediately and are saved in your browser. The initial settings are English and light blue; they do not follow the browser or OS settings. Card content is not translated. CLI help, errors, and API/JSON values remain in English.

## Use the CLI

Add a card and inspect the board:

```sh
agboard --project "My project" add "Write the setup guide" --assignee ai --actor ai
agboard --project "My project" ls --json
agboard --project "My project" show 1 --json
agboard --project "My project" snapshot --json
```

`--assignee` identifies the owner; `--actor` records who makes the change. Use `human` for a user and `ai` for an agent. `snapshot` returns the complete board and history, including epics and any file problems.

Report the start of work:

```sh
agboard --project "My project" mv 1 doing --actor ai --reason "Start implementation"
agboard --project "My project" state 1 running --actor ai --reason "Writing and checking the guide"
```

To finish, record verification in `TASK.md` and set each verified acceptance item's `done` to `true`. A running server moves eligible AI cards to Done automatically; do not issue `mv ... done --actor ai`. See [shared Markdown files](#edit-shared-markdown-files) for the format and eligibility rules. Done cards are read-only for agents: they cannot edit the task, change its lane or state, or add attachments or evidence. A user can reopen a card when more work is needed.

For longer Markdown, use a file rather than a command-line string:

```sh
agboard --project "My project" edit 1 --desc-file task.md
```

Descriptions and epic plans allow up to 50,000 characters. The file must follow the required [Markdown format](#edit-shared-markdown-files). Use `--desc -` to read a description from standard input.

Filter cards or inspect every project:

```sh
agboard --project "My project" ls --column doing --json
agboard --project "My project" ls --state pending --json
agboard ls --all-projects --json
```

`ls --all-projects` reads all projects consistently in project-name order, with complete card descriptions and history. Its `--column` and `--state` filters apply to every project; do not combine it with `--project`.

Add `--json` for machine-readable output. Use `agboard --help` or `agboard <command> --help` for the full command options. Card, epic, evidence, and project deletion require human confirmation; agents must ask a user to perform them.

## Read the progress table

```sh
agboard progress
agboard progress --json
agboard --project "My project" progress --json
```

The table groups Todo and Doing cards under their epics, with a separate group for work without an epic. Done, archived, and Pending cards are omitted. Pending questions remain on the board until answered; use `show` or `snapshot` to inspect them. Human-owned and draft cards remain in progress for context, but agents must skip them when choosing work.

Each entry includes the card ID, title, owner, lane, agent state, acceptance counts, and its `taskPath`. Epic entries include `planPath`. Bodies, history, and image bytes are omitted: read only the files needed for the selected work. Hooks supply this same table.

Epics appear in ID order. Within an epic, the `priority` list in `PLAN.md` determines task order; IDs not listed follow in ascending card-ID order. Work without an epic is also sorted by card ID. This order is independent of lane positions. Epics with no listed cards are omitted.

## Ask and answer decisions

An AI-owned card must be in Doing to become Running. It can ask a Pending question in either Todo or Doing. A question for the user always has choices: pass the question and two to ten options as JSON with `--request-json`, either inline or from standard input with `-`:

```json
{
  "question": "Which launch approach should we use?",
  "choices": [
    { "id": "preview", "label": "Publish a preview first" },
    { "id": "public", "label": "Launch publicly" }
  ]
}
```

Send it inline:

```sh
agboard --project "My project" state 1 pending --actor ai --request-json '{"question":"Which launch approach should we use?","choices":[{"id":"preview","label":"Publish a preview first"},{"id":"public","label":"Launch publicly"}]}'
```

Or read it from standard input:

```sh
cat question.json | agboard --project "My project" state 1 pending --actor ai --request-json -
```

Add a `wait` object to the JSON to ask and wait for the answer in one command. It needs a running `agboard serve`. An empty object waits indefinitely and prints the answer (the choice, the note, and the card) once the request is answered:

```json
{
  "question": "Which launch approach should we use?",
  "choices": [
    { "id": "preview", "label": "Publish a preview first" },
    { "id": "public", "label": "Launch publicly" }
  ],
  "wait": {}
}
```

You may add `"timeoutSeconds": 600` to limit this wait command; the value must be from 1 to 86,400 (a day). Without `wait`, the command asks and returns. A timeout or Ctrl+C stops waiting but leaves the request Pending. A lost server connection returns `board_unavailable`, a technical error that also leaves the request Pending. If a card move withdraws the question, the command exits with `request_changed`. Without a running server, nothing is asked.

`choices` takes 2 to 10 options; a request with fewer or more is refused, and so is a pending state without `--request-json`. The request gets an ID; read the current request in `show` or `snapshot`. A user can answer in the browser, or pass that request ID to the CLI:

```sh
agboard --project "My project" state 1 idle --actor human --request "<request-id>" --choice preview --reason "Get feedback before the public launch"
```

The user can supply a choice, a note with `--reason`, or both. After reading the full response and history, the agent can resume:

```sh
agboard --project "My project" state 1 running --actor ai --reason "Preparing the preview requested by the user"
```

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

## Workflow for agents

Configure hooks using the [Claude Code and Codex integration guide](../integrations/README.md). Hooks resolve the nearest registered project folder and supply the same concise progress table as `agboard progress`; use `show` to read a task or history when needed.

1. Read `agboard progress --json` and select a ready AI-owned card following its epic's saved task order. Read only the selected epic's `PLAN.md` and task's `TASK.md`; use `show` when its history or an active question is needed.
2. Move an AI-owned card to Doing with a reason, then report Running. Review a user-owned card only when it affects the work.
3. Record execution, verification results, and evidence in the shared files. Ask a question through Pending when a decision is needed.
4. After an answer, read the card and history, reconsider the plan, and resume with a reason. Mark acceptance conditions done only after verification; eligible AI cards move to Done automatically when all conditions are complete.
5. If no work can proceed, wait for a change using the cursor from the same project's snapshot:

```sh
agboard --project "My project" snapshot --json
agboard --project "My project" wait --after "<cursor>" --json
```

A cursor has the format `f1:<project-id>:<version>`. Treat it as the value returned by `snapshot`; do not construct one. `wait` requires a running `agboard serve` in the same data area and listens for changes without polling. It follows the same project ID through a rename; update the name in future commands and hooks.

A draft (`isDraft: true`) is read-only for agents: `edit`, `mv`, and `state` fail with `card_is_draft`. Work on other cards until the user finalizes it. On `AGBOARD_ERROR`, a missing project, a technical connection failure, or an unreadable board, report the problem and stop board-dependent changes until a valid progress table is available. A timeout or interruption of a wait does not answer or expire a question.

## Edit shared Markdown files

Find the project's files instead of assuming their location:

```sh
agboard --project "My project" workspace --json
```

The result contains `folder` (the project's absolute path), `projectId`, `readme`, `tasks`, and `epics`. Read the project's `README.md` before editing files.

Agents may edit a non-draft card's `TASK.md` and an epic's `PLAN.md` as that README allows. For direct edits, write a temporary file in the same folder and rename it over the original. The board follows file changes automatically. Use the CLI for metadata and status changes; never edit `task.json`, `epic.json`, `project.json`, or `.internal/` lock files directly, or delete card or epic folders directly. Keep personal absolute paths out of shared files.

TASK.md and PLAN.md hold their completion conditions in a YAML frontmatter at the top of the file. The body after it is free Markdown; no heading is required:

```markdown
---
acceptance:
  - id: AC-1
    text: The setup guide covers the supported installation steps.
    done: false
  - id: AC-2
    text: Deleting a card asks for confirmation.
    done: true
---

## Background

Any headings and text you need.
```

Each condition has three keys: `id` (`AC-` followed by a positive number without a leading zero, unique in the file), `text` (1 to 2,000 characters after trimming), and `done` (`true` or `false`). Other keys in the frontmatter are kept when the board writes the file. A file without a frontmatter has no conditions, and its whole text is the body.

If the frontmatter cannot be read (invalid YAML, a missing key, a duplicate ID, an empty text), the board reports the file, the item, and the reason as a problem. The card then shows no progress and its body is shown in full. The board never rewrites the file to fix it.

Mark a condition `done: true` only after you have verified it, and record the result and evidence in the body (for example in an execution log section). While `agboard serve` is running, a non-draft, unarchived AI-owned Todo or Doing card with at least one valid condition moves to Done automatically once all conditions are done. The server also checks existing cards at startup. Pending cards wait until answered; human-owned cards, drafts, invalid acceptance data, and empty condition lists do not auto-complete. Reopening a card without unchecking a condition can cause it to complete again. An epic's own conditions are checked separately; completing its tasks does not check them automatically.

An epic's frontmatter can also contain a `priority` list of distinct positive card IDs. It controls the epic progress panel and CLI progress order, independently of board lane order:

```yaml
priority: [3, 1, 2]
```

New cards and epics start with an empty `acceptance` list. Files written before this format, with Japanese headings such as `## 作業内容` and `- [ ] AC-1.` lines, are read as bodies with no conditions; they are not converted.

## Data and backups

The default data folder is `agboard/` under the OS application data folder:

| OS | Default folder |
| --- | --- |
| macOS | `~/Library/Application Support/agboard/` |
| Windows | `%APPDATA%\agboard\` |

Set `AGBOARD_HOME` to use another data folder. The CLI, server, and hooks must use the same folder to share a board.

```text
shared/
  workspace.json
  projects/<project-id>/
    README.md
    project.json
    tasks/<card-id>/
      task.json
      TASK.md
      assets/
      evidence/
    epics/<EPIC-ID>/
      epic.json
      PLAN.md
      assets/
```

Stop `agboard serve`, agents, and editors writing to the files before backing up or restoring. Copy the whole `shared/` folder to preserve all projects and the workspace format. For one project, copy its entire folder, using the `folder` value from `workspace --json`. Restore the copy to the same location before restarting the server and agents.

Folder registrations live separately in `bindings.json` in the data area and contain machine-specific paths. Keep that file for a same-machine backup if needed; use `project bind` to register the correct folders on another machine. Do not commit it or place it inside the shared project files.
