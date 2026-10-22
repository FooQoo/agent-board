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
| Attach images | `attachment` |
| Group and order tasks | `epic`, `progress` |
| Wait for a change | `wait` |
| Manage projects and folders | `project`, `workspace` |
| Run the server and agent access | `serve`, `setup`, `hook` |
| Delete things (people only) | `rm`, `project rm`, `epic rm`, `init` |

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
agboard --project "My project" history add 1 --reason "Checked the installation links and recorded the result in the task body"
agboard --project "My project" history add 1 --reason-file progress.txt
```

The command assigns the timestamp and applies AI write permissions; it needs no actor, event ID, kind, or time. Write concise reasons based on actual work and verification, at meaningful progress, decisions, verification, interruption, or resumption. A missing or blank reason produces a default that matches the state. An AI cannot append history to drafts, archived tasks, or Done tasks.

### Finish a task

To finish, record the verification in `TASK.md` and set each verified acceptance condition's `done` to `true`. A running server moves eligible AI tasks to Done automatically, so do not run `mv ... done --actor ai`. See the [Markdown file format](./file-format) for the rules. A Done task is read-only for agents; a user can reopen it when more work is needed.

### Ask a question

Use `state ... pending --request-json` to ask a decision. The command waits for an answer by default; use `--no-wait` only when you explicitly want to register the question and return immediately. Waiting requires a running `agboard serve`; `--no-wait` does not. Do not combine `--no-wait` with an integer `wait.timeoutSeconds`: it returns `invalid_argument` (exit 2) without changing the question or task. See [Decisions](../use/decisions) for the three command forms. For epics and the progress table, see [Epics and progress](../use/epics).

## Edit long text from a file

For longer Markdown, use a file rather than a command-line string:

```sh
agboard --project "My project" edit 1 --desc-file task.md
```

Descriptions allow up to 50,000 characters and epic details (`EPIC.md`) up to 100,000, and the file must follow the [Markdown file format](./file-format). Use `--desc -` to read a description from standard input.

`edit --desc-file` replaces the body and acceptance conditions and keeps the latest history from `TASK.md`; history in the input file is ignored. Moves, state changes, and other operations from the CLI or the UI append history to `TASK.md`, and `show`, `snapshot`, and the browser read that same history.

## Edit epic details

An epic's details are the whole `EPIC.md` text, frontmatter included. Pass the text directly, or read it from a file or standard input:

```sh
agboard --project "My project" epic edit LAUNCH --document-file epic.md
agboard --project "My project" epic edit LAUNCH --document -
agboard --project "My project" epic edit LAUNCH --priority "3,1,2"
```

`--document` and `--document-file` cannot be given together, and each accepts up to 100,000 characters. The earlier `--plan` and `--plan-file` options were removed; see [Data and backups](../operations/data) for the new names.

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

## Wait for changes or a task

The `wait` command has two modes. `--after <cursor>` waits for a project change as described in [Working with agents](./agents#wait-for-changes). `--until task` returns one eligible AI task, including one that was already in Todo or an idle task in Doing before listening started:

```sh
agboard --project "My project" wait --until task --idle-timeout 300 --json
```

`--idle-timeout` is required with `--until task` and accepts 1 to 86,400 seconds. It has no default. Each invocation returns at most one task, in the same order as the progress table; it does not claim or change the task. After resolving the returned task, call `wait` again to continue. See [Working with agents](./agents#listen-for-the-next-task) for the full session workflow and how Pending tasks are handled.

On success, task mode prints one JSON object and exits 0:

```json
{"kind":"task","projectId":"<id>","cursor":"<cursor>","task":{"id":1},"taskPath":"…/tasks/1/TASK.md","documentPath":null}
```

When there has been no eligible task for the full interval, it prints `{"kind":"idle_timeout","projectId":"<id>","idleTimeoutSeconds":300}` and exits 0. This is a normal idle completion; it does not say that previous work succeeded. `board_unavailable`, `project_not_found`, invalid board data, and invalid arguments remain errors with non-zero exit codes. `--timeout` applies only to `--after` mode; it reports `wait_timeout` as an error and does not answer a Pending question.

## Run the server

`agboard serve` starts the board on `127.0.0.1`. `--port` chooses the port (default 7420). To also connect a phone through ngrok when the server starts, add `--monitor ngrok`:

| Option | Meaning |
| --- | --- |
| `--monitor ngrok` | Starts the mobile monitor connection. `ngrok` is the only mode. Needs `NGROK_AUTHTOKEN` in the environment; the token is never passed as an argument. |

The phone is guarded by a 4-digit passcode that is made for each start; there is no sign-in option. An invalid `--monitor` value, a missing `NGROK_AUTHTOKEN`, or an unknown option exits with code 2. If the connection cannot start, `serve` exits with code 1 and does not start.

When the connection is ready, the startup line shows the phone address and the passcode: `Serving at http://127.0.0.1:7420/; mobile monitor at https://… with passcode 4821`. With `--json`, the startup line has the `url` of the board and `monitor` with `mode: "ngrok"`, and the phone `url` and `passcode` in `ngrok`. The passcode is printed only here and in the board's connection dialog; tokens and policies are never printed. You can also set up the connection from the board's **Settings**; see the [mobile monitor guide](../operations/mobile-monitor).

## Set up the shared folder

`agboard setup` creates the data folder and its `shared/` folder, then adds the data folder to the Codex and Claude Code user settings so that agents can write there. It needs no project, and you run it yourself; it does not install hooks or the agent skill.

```sh
agboard setup --dry-run
agboard setup --agent claude --json
```

`--agent codex|claude|all` chooses the settings to update (default `all`). `--dry-run` changes nothing, and `--json` prints machine-readable output. The command refuses a Codex configuration that is not `sandbox_mode = "workspace-write"` and changes nothing when it refuses. See [Data and backups](../operations/data#set-up-the-shared-folder) for the settings it changes and how it backs them up.

## Output and confirmation

Add `--json` for machine-readable output. The help text, errors, and JSON values are always in English, whatever language the browser uses.

Deleting a task, epic, or project, and emptying a project with `init`, needs a person's confirmation in a terminal. Agents must ask a person to do it.

## Next

- [Working with agents](./agents): where these commands fit in the work loop.
- [Troubleshooting](../operations/troubleshooting): what an error code means.
