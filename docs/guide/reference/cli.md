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
| Open the board in the browser | `open` |
| Get the phone address and passcode | `remote` |
| Run the server and the hook | `serve`, `stop`, `hook` |
| Install and update the Agent Board plugin | `setup`, `update` |
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

Moves and state changes accept an optional `--reason` of up to 10,000 Unicode characters. A missing or blank reason is generated from the current state. These operations add history by themselves; do not add a second entry for the same change. A question can be up to 5,000 characters, and an answer note up to 2,000 characters.

Record meaningful progress that does not change the column or state:

```sh
agboard --project "My project" history add 1 --reason "Checked the installation links and recorded the result in the task body"
agboard --project "My project" history add 1 --reason-file progress.txt
```

The command assigns the timestamp and applies AI write permissions; it needs no actor, event ID, kind, or time. Write concise reasons based on actual work and verification, at meaningful progress, decisions, verification, interruption, or resumption. A missing or blank reason produces a default that matches the state. An AI cannot append history to a person's drafts, archived tasks, or Done tasks.

### Finish a task

To finish, record the verification in `TASK.md` and set each verified acceptance condition's `done` to `true`. The server moves eligible AI tasks to Done automatically (the hook and waiting commands start it when needed), so do not run `mv ... done --actor ai`. See the [Markdown file format](./file-format) for the rules. A Done task is read-only for agents; a user can reopen it when more work is needed.

### Ask a question

Use `message ask` to ask the user up to 20 questions. Each question is its own message, such as `Q-12`, and belongs to the project; `--task <id>` makes a task refer to them, and the task shows Pending until they are answered. The command prints one event per line (JSON Lines with `--json`) and waits until none is open, 600 seconds by default:

```sh
agboard --project "My project" message ask --actor ai --task 1 --questions-json - --json < questions.json
```

It ends with `answered` (exit 0), `timeout` (exit 5, the questions stay open), or `withdrawn` (exit 6). Wait again with `message wait Q-12 Q-13`. Waiting needs the server: the command starts it in the background when none is running, before it saves the questions. `--no-wait` registers the questions and returns at once without one. `message answer`, `message ls`, `message show`, `message withdraw`, `message link`, and `message unlink` record an answer, read messages, withdraw a question, and change which tasks refer to a question. `message send` and `message accept` handle requests from a person to the agents. See [Decisions](../delegate/decisions) for the question format and every command. For epics and the progress table, see [Epics and progress](../watch/epics).

## Edit long text from a file

For longer Markdown, use a file rather than a command-line string:

```sh
agboard --project "My project" edit 1 --desc-file task.md
```

Descriptions allow up to 50,000 characters and epic details (`EPIC.md`) up to 100,000, and the file must follow the [Markdown file format](./file-format). Use `--desc -` to read a description from standard input.

`edit --desc-file` replaces the body and acceptance conditions and keeps the latest history and the question references (`questions`) from `TASK.md`; `history` and `questions` in the input file are ignored, so a task that refers to an open question stays pending. Use `message link` and `message unlink` to change the references. Moves, state changes, and other operations from the CLI or the UI append history to `TASK.md`, and `show`, `snapshot`, and the browser read that same history.

## Edit epic details

An epic's details are the whole `EPIC.md` text, frontmatter included. Pass the text directly, or read it from a file or standard input:

```sh
agboard --project "My project" epic edit LAUNCH --document-file epic.md
agboard --project "My project" epic edit LAUNCH --document -
agboard --project "My project" epic edit LAUNCH --priority "3,1,2"
```

`--document` and `--document-file` cannot be given together, and each accepts up to 100,000 characters.

Everything an agent creates (`add`, `epic add`) starts as an AI draft. An agent can edit it, but `mv` and `state` fail with `task_is_draft` until the draft is started:

```sh
agboard --project "My project" start 12 --actor ai
agboard --project "My project" epic start LAUNCH --actor ai
```

`start` clears the AI draft of one task. `epic start` clears the epic and every AI draft task of it in one step, and leaves tasks that a person is still drafting. The agent that wrote the plan starts it once its questions are answered and the plan is written up, and a person can run the same commands with `--actor human`. An open question linked to the task, or to an AI draft task of the epic, refuses the start with `start_blocked_by_questions` (exit code 1). Each started task records who started it: "The agent wrote the plan up and started the task." or "A person started the task."

While a person has an epic in draft in the browser, `epic edit` fails with `epic_is_draft` (exit code 1) and changes nothing, `--priority` included. Wait until the person saves or discards it, or ask them to finalize a draft that was left behind. `epic attachment` and changing a task's epic still work.

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

The `wait` command has two modes. `--after <cursor>` waits for a project change as described in [Working with agents](../delegate/agents#wait-for-changes). `--until task` returns one eligible AI task, including one that was already in Todo or an idle task in Doing before listening started:

```sh
agboard --project "My project" wait --until task --idle-timeout 300 --json
```

`--idle-timeout` is required with `--until task` and accepts 1 to 86,400 seconds. It has no default. Each invocation returns at most one task, in the same order as the progress table; it does not claim or change the task. After resolving the returned task, call `wait` again to continue. See [Working with agents](../delegate/agents#listen-for-the-next-task) for the full session workflow and how Pending tasks are handled.

On success, task mode prints one JSON object and exits 0:

```json
{"kind":"task","projectId":"<id>","cursor":"<cursor>","task":{"id":1},"taskPath":"…/tasks/1/TASK.md","documentPath":null}
```

Before a task, the wait can return `{"kind":"answers",…}` (answers to questions that no agent has taken in) or `{"kind":"requests",…}` (open requests), answers first. Take each in with `message accept` and wait again.

When there has been no eligible task for the full interval, it prints `{"kind":"idle_timeout","projectId":"<id>","idleTimeoutSeconds":300}` and exits 0. This is a normal idle completion; it does not say that previous work succeeded. `board_unavailable`, `project_not_found`, invalid board data, and invalid arguments remain errors with non-zero exit codes. `--timeout` applies only to `--after` mode; it reports `wait_timeout` as an error and does not answer a question.

## Run the server

You rarely need to start the server yourself. `wait`, a question that waits for its answer, and the agent hook start it in the background when none is running. A command that starts it prints one line on standard error:

```text
Started the Agent Board server at http://127.0.0.1:7420/ in the background. It stops by itself after 30 minutes without use.
```

A server started this way keeps running while the board is open in a browser, while an agent waits, or while the phone is connected. It stops after 30 minutes without any of these; set `AGBOARD_IDLE_TIMEOUT` (60 to 86,400 seconds) to change that. If port 7420 is taken, it uses a free port and says so. Set `AGBOARD_AUTOSTART=0` to turn automatic starts off; commands that need the server then fail with `board_unavailable`, as when no server runs. Other commands, such as `add`, `mv`, and `ls`, never start the server.

### Open the board in the browser

A server that starts in the background opens the board of the project it started for, once, in your default browser. Before it opens the page, it waits about three seconds: if a board tab that was already open connects again, for example after the computer woke from sleep, it opens nothing. A question that arrives while the server runs does not open the browser, and neither does `agboard serve` or `agboard serve -d`.

The browser is not opened when:

- `AGBOARD_OPEN_BROWSER=0` is set;
- the command runs in an SSH session (`SSH_CONNECTION` or `SSH_TTY` is set);
- on Linux, no display is available (`DISPLAY` and `WAYLAND_DISPLAY` are unset).

Whether it opened the page, and why not, is written to `serve.log` in the data folder.

To open the board yourself, run `agboard open`. It opens the board of the project bound to the current folder, or of the one `--project` names, and starts the server in the background first when none runs:

```sh
agboard open
agboard --project "My project" open
agboard open --print
```

It prints the board's address, such as `http://127.0.0.1:7420/?project=<id>`, even when it opens it. `--print` only prints the address. With `--json`, it prints `{"url":"…","projectId":"…","opened":true}`; when the browser was not opened, `opened` is `false` and `notice` says why. With `AGBOARD_AUTOSTART=0` and no server running, it fails with `board_unavailable`; a program that cannot be started fails with `browser_open_failed`, and the message names the address to open yourself.

Agent Board uses `open` on macOS and `xdg-open` on Linux. To use another program, set `AGBOARD_BROWSER_OPENER` to it; Agent Board runs it with the address as its only argument, also over SSH or without a display.

### Start the server yourself

Start it yourself to keep it running, to choose the port, or to connect a phone when it starts.

`agboard serve` starts the board on `127.0.0.1`. `--port` chooses the port (default 7420). To also connect a phone through ngrok when the server starts, add `--monitor ngrok`:

| Option | Meaning |
| --- | --- |
| `--monitor ngrok` | Starts the remote access connection. `ngrok` is the only mode. Needs `NGROK_AUTHTOKEN` in the environment; the token is never passed as an argument. |

The phone is guarded by a 4-digit passcode that is made for each start; there is no sign-in option. An invalid `--monitor` value, a missing `NGROK_AUTHTOKEN`, or an unknown option exits with code 2. If the connection cannot start, `serve` exits with code 1 and does not start.

When the connection is ready, the startup line shows the phone address and the passcode: `Serving at http://127.0.0.1:7420/; remote access at https://… with passcode 4821`. With `--json`, the startup line has the `url` of the board and `monitor` with `mode: "ngrok"`, and the phone `url` and `passcode` in `ngrok`. The passcode is printed only here and in the board's connection dialog; tokens and policies are never printed. You can also set up the connection from the board's **Settings**; see the [remote access guide](../watch/remote-access).

### Run in the background

`agboard serve -d` (or `--daemon`) starts the server in the background and returns once it is ready, so the terminal is free and closing it does not stop the server. It prints the same address (and, with `--monitor ngrok`, the phone address and passcode) plus the process ID and the log file. `--port` and `--monitor` work as usual; with `--json`, the startup object also has `pid` and `log`.

```sh
agboard serve -d
agboard stop
```

`agboard stop` shuts down the running server and returns when it has exited. It stops a server started with `serve`, with `serve -d`, or by a command. After `stop`, the hook does not start the server again until a command that waits, `serve`, or `serve -d` starts one. If no server is running, it says so and exits with code 0. `stop` takes no `--project`.

### Give the phone address and passcode

While the ngrok connection is up, `agboard remote` prints its state, the public address, and the 4-digit passcode, so that an agent can hand you a link without you opening the connection dialog:

```sh
agboard --project "My project" remote
agboard --project "My project" remote --json
```

```text
ngrok: ready
URL: https://….ngrok-free.app/?project=<id>
Passcode: 4821
Project: My project
```

`--project` is required, and the address opens that project. Without it, `remote` prints nothing and exits with code 2 as `invalid_argument`. With `--json` it prints `{"status":"ready","url":"…","entrance":"…","passcode":"…","project":{"id":"…","name":"…"}}`; `entrance` is the address without a project.

`remote` starts nothing. When no server is running, or the connection is not ready, it prints no address and no passcode, says why, and exits with code 1 as `remote_unavailable`. A project that does not exist exits with code 4.

The server gives the passcode only to the local address of your PC, so it is printed to the person running the command and never travels through ngrok. If an agent pastes it into a chat, everyone who can read that chat can open the board for as long as the connection is up. Stop the connection when you are done; see the [remote access guide](../watch/remote-access).

The background server writes its output to `serve.log` in the data folder. The file is readable only by you, because it holds the phone passcode, and it is replaced at every `serve -d`. If the background server cannot start (for example the port is in use), `serve -d` exits with code 1 and shows the reason. The server does not restart by itself after a reboot.

If a command started the running server, `serve -d` keeps that server running instead of starting a new one: it no longer stops by itself, and nothing it serves is interrupted. This needs no `--port` or `--monitor` that differs from the running server. A foreground `agboard serve` exits with `already_serving` and points to `serve -d`.

If a server you started is already running, or the options differ, `serve -d` asks in the terminal whether to stop it and start a new one. Answer `y` to replace it; the new server uses the `--port` and `--monitor` of this command, not those of the old server, and with `--monitor ngrok` it gets a new passcode. Any other answer leaves the running server as it is and exits with code 0. With `--json`, or when the command does not run in a terminal, nothing is asked and `serve -d` exits with code 1 (`already_serving`).

## Setup and update {#setup-and-update}

`setup` creates the data folder and installs the Agent Board plugin (the Skill and the Hook) for Codex, Claude Code, or both. `update` moves an installed plugin to the version of the command. What they ask and change is in [Working with agents](../delegate/agents#set-up-your-agents).

```sh
agboard setup
agboard setup --agent codex --dry-run
agboard setup --agent all --yes --json
agboard update
agboard update --yes
```

| Command | What it does | Exit codes |
| --- | --- | --- |
| `agboard setup` | Creates the data folder, asks which agents to set up, shows the plan, and after you answer `y` installs the plugin, lets the agents use the shared folder, and trusts the Agent Board hooks in Codex. Needs no project. | `0` success, nothing to change, or a cancel. `1` an agent failed, or no agent could be set up. `2` bad command line, or missing options without a terminal. |
| `agboard update` | Moves the plugin of every agent that has it to this version and trusts the new Codex hooks. Shows the plan and asks first. | `0` success, nothing to update, or a cancel. `1` an agent failed. `2` bad command line, or missing options without a terminal. |

Both commands take these options:

- `--agent codex|claude|all` chooses the agents. Without it, `setup` asks on a terminal, and `update` takes every agent that has the plugin.
- `--yes` agrees in advance, including the trust of the Codex hooks.
- `--dry-run` shows the plan and installs, creates, and changes nothing.
- `--json` prints machine-readable output.

Neither command waits on a pipe. Without a terminal, or with `--json`, `setup` needs `--agent`, and both need `--yes` or `--dry-run`; otherwise they exit with `2`. An agent whose command is not on `PATH` is skipped with the reason. Failure reasons go to the error output. See [Data and backups](../operations/data#set-up-the-shared-folder) for the settings files they change and how they back them up.

## Output and confirmation

Add `--json` for machine-readable output. The help text, errors, and JSON values are always in English, whatever language the browser uses.

Deleting a task, epic, or project, and emptying a project with `init`, needs a person's confirmation in a terminal. Agents must ask a person to do it.

## Next

- [Working with agents](../delegate/agents): where these commands fit in the work loop.
- [Troubleshooting](../operations/troubleshooting): what an error code means.
