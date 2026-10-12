# Agent Board usage guide

Agent Board is a local work board shared by users and AI agents. Each project has its own cards, epics, and history. Use the browser for reviewing and editing work, and `agboard` for agent updates and project management.

[README](../README.md) · [Mobile monitor](mobile-monitor.md) · [Claude Code and Codex integration](../integrations/README.md) · [Contributing](../CONTRIBUTING.md)

- [Installation and updates](#installation-and-updates)
- [Start a project](#start-a-project)
- [Use the browser](#use-the-browser)
- [Use the CLI](#use-the-cli)
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

A rename preserves the project's ID and cards. Update its name in hook commands and agent instructions afterward. `project rm` deletes the named project and its cards, asks for human confirmation, and is unavailable to agents.

Every command requires `--project NAME` except `project create`, `project ls`, `serve`, and the read-only `ls --all-projects`. Nothing is selected implicitly from the browser, working directory, or another agent.

The examples below use `My project`; substitute your actual project name and the IDs returned by the CLI.

## Use the browser

### Cards and progress

1. Select a project in the header and choose **Add card**.
2. Enter the title, choose AI or User as the owner, and write the work and completion conditions in the Markdown editor. You can also assign an epic.
3. Select a card to view its text, status, and history in the detail panel. To edit its text, choose **Make draft**, then open the editor. To move it to another column, drag it to that column and confirm the reason.

A card's owner is fixed after creation. The columns describe work progress:

| Column | Meaning |
| --- | --- |
| Todo | Work that has not started. |
| Doing | Work in progress. AI-owned cards also show an agent state. |
| Done | Completed work. |

AI-owned cards in Doing show **Idle**, **Running**, or **Pending**. Running means the agent is working; Pending means it needs a response. Moving a card to Todo or Done resets its agent state to Idle. Changes and their reasons remain in the history.

### Decisions and drafts

Select a Pending card to read the question and its history. Choose one of the offered options, write a note, or do both, then submit the answer. The answer is recorded and the agent state becomes Idle; the agent reads the response before deciding how to resume.

Use the **Draft** checkbox when creating a card that agents should leave alone. For an existing card, choose **Make draft** in the detail panel, edit and save its text, then choose **Finalize** when it is ready for an agent. Saving in the card editor keeps its draft state; the editor has no Draft checkbox. Draft cards are read-only for agents, including their `TASK.md` files.

### Plans, editing, and archive

Open an epic from its label to review its plan. The epic dialog lets you edit the name, color, plan, and task membership together. Each card belongs to at most one epic.

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

Report the start of work, then completion:

```sh
agboard --project "My project" mv 1 doing --actor ai --reason "Start implementation"
agboard --project "My project" state 1 running --actor ai --reason "Writing and checking the guide"
agboard --project "My project" mv 1 done --actor ai --reason "Guide completed and verified"
```

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

## Ask and answer decisions

An AI-owned card must be in Doing before its agent state can become Running or Pending. A question for the user always has choices: pass the question and two to ten options as JSON with `--request-json`, either inline or from standard input with `-`:

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

Add a `wait` object to the JSON to ask and wait for the answer in one command. It needs a running `agboard serve`, and it prints the answer (the choice, the note, and the card) once the request is answered:

```json
{
  "question": "Which launch approach should we use?",
  "choices": [
    { "id": "preview", "label": "Publish a preview first" },
    { "id": "public", "label": "Launch publicly" }
  ],
  "wait": { "timeoutSeconds": 600 }
}
```

`timeoutSeconds` is required, from 1 to 86,400 (a day). Without `wait`, the command asks and returns. A timeout is not an answer: the command exits with `wait_timeout` and the request stays pending. If a move takes the question back, it exits with `request_changed`. Without a running server, or with a `wait` that is not valid, nothing is asked.

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

Epic IDs use letters, digits, and hyphens; lowercase input is normalized to uppercase. The plan file uses the required `PLAN.md` headings. Use `--name` or `--color '#7C3AED'` with `epic edit` to change the name or color. A card belongs to at most one epic.

## Add images and evidence

Use the browser editor to select, drop, or paste an image, then insert it into the card text. Image attachments support PNG, JPEG, WebP, and GIF. With the CLI:

```sh
agboard --project "My project" attachment add 1 --file diagram.png --actor ai
agboard --project "My project" attachment ls 1 --json
agboard --project "My project" attachment get 1 "<attachment-id>" --output diagram-copy.png
```

Images use persistent `attachment:<attachment-id>` references in card Markdown. Snapshots and hooks include attachment metadata; image bytes stay in local files. `attachment get` never overwrites an existing output file.

Add a UTF-8 log or other text as evidence, then use the returned evidence ID to read it:

```sh
agboard --project "My project" evidence add 1 test-output.log
agboard --project "My project" evidence show 1 "<evidence-id>"
```

## Workflow for agents

Configure hooks using the [Claude Code and Codex integration guide](../integrations/README.md). Each hook names one project and supplies its complete snapshot after tools run.

1. Use the project the user specified. Check its ID and name in the snapshot and read every card and its history before choosing work.
2. Move an AI-owned card to Doing with a reason, then report Running. Review user-owned cards to understand the overall plan.
3. Record execution, verification results, and evidence in the shared files. Ask a question through Pending when a decision is needed.
4. After an answer, read the complete snapshot and history, reconsider the plan, and resume with a reason. Move completed work to Done after the required verification and acceptance.
5. If no work can proceed, wait for a change using the cursor from the same project's snapshot:

```sh
agboard --project "My project" snapshot --json
agboard --project "My project" wait --after "<cursor>" --json
```

A cursor has the format `f1:<project-id>:<version>`. Treat it as the value returned by `snapshot`; do not construct one. `wait` requires a running `agboard serve` in the same data area and listens for changes without polling. It follows the same project ID through a rename; update the name in future commands and hooks.

A draft (`isDraft: true`) is read-only for agents: `edit`, `mv`, and `state` fail with `card_is_draft`. Work on other cards until the user finalizes it. Hooks include complete descriptions and history only when the snapshot fits within 256 KiB. On `AGBOARD_ERROR`, a missing project, a timeout, or an unreadable board, report the problem and stop board-dependent changes until a complete snapshot is available.

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

Mark a condition `done: true` only after you have verified it, and record the result and the evidence in the body (for example in an execution log section). An agent can move a card to Done only when every condition is done; the board refuses the move and names the unmet IDs otherwise (`acceptance_unmet`). A person can always move a card.

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
