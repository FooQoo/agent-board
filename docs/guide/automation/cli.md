---
title: CLI reference
---

# CLI reference

Use the browser to review and edit work, and `agboard` for agent updates and project management. Most commands take an explicit `--project NAME`; the examples use `My project`, so replace it with your project's name and use the task IDs the CLI returns. Run `agboard --help` or `agboard <command> --help` for every option.

## Commands at a glance

| I want to… | Command |
| --- | --- |
| Add a task | `add` |
| Read a task or the board | `show`, `ls`, `snapshot` |
| Move a task or report what an agent is doing | `mv`, `state` |
| Record progress | `history add` |
| Change a task's text | `edit` |
| Attach images and logs | `attachment`, `evidence` |
| Group and order tasks | `epic`, `progress` |
| Wait for a change | `wait` |
| Manage projects and folders | `project`, `workspace` |
| Run the server and agent access | `serve`, `setup`, `hook` |
| Delete things (people only) | `rm`, `project rm`, `epic rm`, `evidence rm`, `init` |

## Add and inspect tasks

Add a task and inspect the board:

```sh
agboard --project "My project" add "Write the setup guide" --assignee ai --actor ai
agboard --project "My project" ls --json
agboard --project "My project" show 1 --json
agboard --project "My project" snapshot --json
```

`--assignee` names the owner. `--actor` names who makes the change and controls permissions: use `human` for a person and `ai` for an agent. `snapshot` returns the complete board and history, including epics and any file problems.

## Report work

Report the start of work:

```sh
agboard --project "My project" mv 1 doing --actor ai --reason "Start implementation"
agboard --project "My project" state 1 running --actor ai --reason "Writing and checking the guide"
```

Moves and non-Pending state changes accept an optional `--reason` of up to 10,000 Unicode characters. A missing or blank reason is generated from the current state. These operations add history by themselves; do not add a second entry for the same change. Questions and answers have their own limit of 2,000 characters.

Record meaningful progress that does not change the column or state:

```sh
agboard --project "My project" history add 1 --reason "Checked the installation links and saved the build output as evidence"
agboard --project "My project" history add 1 --reason-file progress.txt
```

The command assigns the timestamp and applies AI write permissions; it needs no actor, event ID, kind, or time. Write concise reasons based on actual work and verification, at meaningful progress, decisions, verification, interruption, or resumption. A missing or blank reason produces a default that matches the state. An AI cannot append history to drafts, archived tasks, or Done tasks.

### Finish a task

To finish, record the verification in `TASK.md` and set each verified acceptance condition's `done` to `true`. A running server moves eligible AI tasks to Done automatically, so do not run `mv ... done --actor ai`. See the [Markdown file format](./file-format) for the rules. A Done task is read-only for agents; a user can reopen it when more work is needed.

### Ask a question

Use `state ... pending` with `--request-json` to ask a decision; see [Decisions](../use/decisions). For epics and the progress table, see [Epics and progress](../use/epics).

## Edit long text from a file

For longer Markdown, use a file rather than a command-line string:

```sh
agboard --project "My project" edit 1 --desc-file task.md
```

Descriptions and epic plans allow up to 50,000 characters, and the file must follow the [Markdown file format](./file-format). Use `--desc -` to read a description from standard input.

`edit --desc-file` replaces the body and acceptance conditions and keeps the latest history from `TASK.md`; history in the input file is ignored. Moves, state changes, and other operations from the CLI or the UI append history to `TASK.md`, and `show`, `snapshot`, and the browser read that same history.

## Filter and list

```sh
agboard --project "My project" ls --column doing --json
agboard --project "My project" ls --state pending --json
agboard ls --all-projects --json
```

`ls --all-projects` reads every project in name order, with complete task descriptions and history. Its `--column` and `--state` filters apply to every project; do not combine it with `--project`.

## Projects

```sh
agboard project create "My project"
agboard project ls --json
agboard --project "My project" project rename "Website launch"
agboard project bind "My project" --folder ./docs
```

Renaming keeps the project's ID, folder registrations, and tasks. Folder registrations and project deletion are described in [Data and backups](../operations/data#projects-and-folders).

## Set up the shared folder

`agboard setup` creates the data folder and its `shared/` folder, then adds the data folder to the Codex and Claude Code user settings so that agents can write there. It needs no project, and you run it yourself; it does not install hooks or the agent skill.

```sh
agboard setup --dry-run
agboard setup --agent claude --json
```

`--agent codex|claude|all` chooses the settings to update (default `all`). `--dry-run` changes nothing, and `--json` prints machine-readable output. The command refuses a Codex configuration that is not `sandbox_mode = "workspace-write"` and changes nothing when it refuses. See [Data and backups](../operations/data#set-up-the-shared-folder) for the settings it changes and how it backs them up.

## Output and confirmation

Add `--json` for machine-readable output. The help text, errors, and JSON values are always in English, whatever language the browser uses.

Deleting a task, epic, evidence, or project, and emptying a project with `init`, needs a person's confirmation in a terminal. Agents must ask a person to do it.

## Next

- [Working with agents](./agents): where these commands fit in the work loop.
- [Troubleshooting](../operations/troubleshooting): what an error code means.
