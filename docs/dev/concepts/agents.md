# Agent integration

Agents use Agent Board through three pieces: the skill that tells them how to work, the hook that hands them the progress table, and the waiting commands that let them block until the project changes or a person answers. This page explains each piece and how `agboard setup` installs them as the Agent Board plugin. The user-facing workflow is in [Working with agents](../../guide/automation/agents.md); the JSON they receive is in [Hook, progress, and wait output](../reference/agent-output.md).

## How the pieces fit together

| Piece | Lives in | Job |
| --- | --- | --- |
| Skill `agent-board` | `plugins/agent-board/skills/agent-board/SKILL.md` | Judgment: how to choose work, report progress, ask decisions, and respect drafts and Done tasks. |
| Hook | `agboard hook` (`src/agent/hook.rs`) | Fetching and formatting: after tool calls, attach the current progress table to the agent's context. |
| Progress table | `src/progress.rs` | The list of workable tasks, shared by `agboard progress` and the hook. |
| `wait` | `src/agent/wait.rs`, `src/agent/task_wait.rs` | Block until the project changes or the next task is ready. |
| `qa ask`, `qa wait` | `src/cli/commands/qa/`, `src/agent/qa_wait.rs` | Ask the user questions and block until every one is answered. |

The skill is named `agent-board`; the executable is `agboard`. A typical loop: the hook shows the progress table → the agent reads only the `EPIC.md` and `TASK.md` it needs → it clarifies an unclear title through `agboard edit --title`, preserving the original request → it moves the task to Doing and Running → it records progress with `history add` → it asks questions with `qa ask` and waits for the answers when blocked → it checks conditions off, and automatic Done finishes the task. Title refinement is a skill instruction shared by the ordinary loop and listener, not a server-side summarization feature.

Agents append progress at the start, meaningful progress, decisions, verification, interruptions, and resumptions, without per-entry approval, and never duplicate entries that operations already appended. The body keeps the plan and concise verification results. Images can be attached when visual proof is useful.

The skill gives `BUG` and `ENHANCEMENT` a fixed-body exception: they are ongoing classification epics, not per-feature plans. Their canonical bodies live in `assets/BUG-EPIC.md` and `assets/ENHANCEMENT-EPIC.md` beside the skill. After one-time initialization in the board’s language, normal work and listener runs record plans and outcomes only on tasks. An explicit user request is required to replace existing non-empty content, with useful old content retained in relevant task bodies. Priority frontmatter remains editable. This is not a server-side edit restriction.

## The progress table and the hook

The progress table lists Todo and Doing tasks that do not wait for a person, grouped by epic in `priority` order, with each task's ID, title, owner, status, acceptance counts, and the paths of its `EPIC.md` and `TASK.md`. It never includes bodies or history. A waiting task higher in the order does not block lower tasks, and a task whose questions are answered returns to the table while it is unfinished. The `pending` section's `question` is the first 200 characters of the open question with the smallest ID.

`src/progress.rs` builds the optional `pending` and `done` sections from `Include`, which `agboard progress` and `agboard hook` fill from `--include-pending` and `--include-done`. The default `Include` adds nothing, so the default table is unchanged. See [Epics and progress](../../guide/use/epics.md#read-the-progress-table) for the options.

The hook identifies the project from the nearest bound ancestor of the input `cwd` (or the process cwd), never from a session ID, and never selects all projects when the folder is unbound, and never falls back to a parent when the nearest binding is broken. It returns the table as `AGBOARD_PROGRESS` JSON in `hookSpecificOutput.additionalContext`, or an `AGBOARD_ERROR` such as `bound_project_missing`. A folder with no binding at all is not an error; see [Hook skip and errors](#hook-skip-and-errors).

- **Claude Code.** The plugin's `hooks/claude.json` registers `agboard hook --agent claude --plugin-version <version>` on SessionStart (`startup`, `resume`, `clear`, and `compact`), PostToolUse, and PostToolUseFailure, without a fixed project name. Generic skill frontmatter hooks are not used.
- **Codex.** The plugin's `hooks/codex.json` registers `agboard hook --agent codex --plugin-version <version>` on SessionStart and PostToolUse. Codex runs a plugin's hooks only once they are trusted; `agboard setup` and `agboard update` trust them (see [Setup and update](#setup-and-update)).
- **Limits.** Input is limited to 64 KiB of UTF-8, the table to 256 KiB, and a run to 10 seconds. Codex's `additionalContextLimit` is set to 0 so the hook enforces its own limit. Exceeding it reports `context_too_large`; output is never truncated and reported as success. When the table cannot be produced or the full input did not arrive, the hook says so and keeps the original tool result.
- **Safety.** Commands are fixed; nothing is built from task text or `tool_input`. The hook never calls agent tools, never triggers itself, and changes no board file. When it adds a progress table, it starts the server in the background if none runs, without waiting, unless `agboard stop` paused that or `AGBOARD_AUTOSTART=0` is set (see [Server and web UI](./server-and-ui.md#how-a-command-starts-a-server)). This keeps automatic Done working while an agent only edits files. Paths appear only in local CLI and hook output, never in remote JSON.

Agents make no board-dependent changes until the table can be read, and they read a fresh table after context compaction.

The skill puts every question on the board as a project question with choices, asked with `qa ask`. During a conversation the agent also shows the same question in the chat, and may use the agent's own question tool for it. It writes a chat answer back with `qa answer --actor human --via chat`, using the user's own words; when the board already holds an answer, `question_answered` returns it, and the agent asks again in the chat if the two differ. The skill uses `--no-wait` only when the user explicitly asks to register a question and return immediately, and never asks only in the chat when the board is unavailable.

The skill turns a multi-task request into a provisional plan: it registers the epic and the tasks first, then asks its `plan` questions and one `start_approval` question in one request. The plan's AI tasks refer to the approval, so the derived Pending state keeps `wait --until task` and the work loop from picking them up until an approving choice is recorded (see [Waiting for a person](./history-and-decisions.md#waiting-for-a-person)). After approval the agent works in the epic's order and calls the user only for unclear intent, preference, irreversible actions, and growing scope. This is a skill instruction; apart from the derived Pending state, the CLI and the server do not enforce it. See [Break a request into tasks](../../guide/automation/agents.md#break-a-request-into-tasks) for what the user sees.

The skill waits the same way in every agent: it keeps `qa ask` running until its last line, and after `timeout` runs `qa wait <request-id>`. Claude Code can run the command in the background and is told when it ends, so the chat stays open; Codex runs it in the foreground, reads its output in chunks without a time limit on the command, and still receives chat input during the turn. The default 600-second wait matches the 10-minute limit of a Claude Code tool call. Nothing pushes an answer into an agent session: the board only stores answers, and the command that waits returns them.

## Waiting for changes

`agboard wait --after <cursor>` blocks until the project changes:

1. Read `pid` and `port` from `serve.json` in the same data area and connect to `GET /api/events`. When no server answers, start one first and wait until it does (see [Server and web UI](./server-and-ui.md#how-a-command-starts-a-server)). If the connection fails after `serve.json` was read, start a server once more.
2. Match the project name against the cursor and fix the ProjectId. A cursor for another project, or in an old format, is `cursor_invalid`.
3. After `ready`, compare the project's current version with the cursor. If they differ, return at once; this catches changes made between fetching and subscribing.
4. Otherwise wait for `changed`. If a re-read shows the same version (another project changed), keep waiting.

- `changed`, `ready`, and keep-alive comments are distinguished. Renames return the same project's snapshot; deletion returns `project_not_found` and never moves to a re-created project.
- The connection limit is 3 seconds, and the wait itself is unlimited by default. With an optional `--timeout`, it checks the version once more at the end and returns `wait_timeout` if nothing changed. A disconnect during the wait returns `board_unavailable`; the wait does not start a server again then. There are no automatic short retries and no periodic polling.
- Disconnects, timeouts, and Ctrl+C never change tasks or history, never count as "no change", and never restart a finished agent.
- Because CLI notifications are best effort, a missed one is caught on the next connection, a real `changed`, or the final read at a timeout.

### Waiting for answers

`qa ask` saves the request, notifies `serve`, and then waits for its answers on the same SSE stream (`src/agent/qa_wait.rs` on top of `wait_engine`). A preflight check runs before the save and starts the server when none runs (see [Server and web UI](./server-and-ui.md#how-a-command-starts-a-server)), so a server that cannot start stores nothing and fails with `board_unavailable`. `qa wait <request-id>` waits again for a request that is already stored and never asks a second time.

The output is JSON Lines with `--json`, or the same events as English sentences without it. The first line is `registered`; the last is `answered` (exit 0), `timeout` (exit 5), `withdrawn` (exit 6), or `error`. In between, `waiting` lines come every `--heartbeat` seconds (default 60, 10 to 600). The heartbeat is a timer and never reads the board; the board is read only when the server reports a change. `answered` comes only when every question of the request is answered. The wait lasts 600 seconds by default; `--timeout` takes 1 to 86,400 seconds, or `none` for no limit. A timeout, interruption, or lost connection leaves the questions open. `--no-wait` prints `registered` after saving and notifying and needs no server.

Asking returns a Running task to Idle. After the answers arrive, the agent reads them and the history, then explicitly resumes Running with a reason. The event fields are in [Agent output](../reference/agent-output.md#qa-events). See [Decision requests](../../guide/use/decisions.md) for the user workflow.

### Waiting for the next task

`agboard --project <name> wait --until task --idle-timeout <seconds> --json` uses the same event-driven wait engine. It reads eligible tasks immediately before subscribing, checks again after the SSE `ready`, and checks after each `changed` event. A single monotonic deadline starts when the initial snapshot has no eligible task; unrelated project changes and keep-alives do not extend it. At the deadline it reads once more, returning a task if one arrived at the boundary, otherwise `idle_timeout` with exit code 0.

The selector uses `ordered_tasks`, the same ordering as the progress table: epics sorted by ID, each epic's saved task priority and then task ID, followed by ungrouped tasks by ID. It returns one AI-owned Todo or Doing task whose shown run state is Idle (a task that waits for a person shows Pending and is never returned), provided it is not a draft or archived. The initial read means tasks created before listening are eligible. The result contains the snapshot cursor, the task, its local `TASK.md` path, and its `EPIC.md` path when it has an epic. Selection is read-only and does not claim a task; callers must re-read its state before acting. The listener procedure checks the complete snapshot first and resolves any existing AI work in `running` or `pending`; an idle task in Doing is eligible to resume. A timeout is a normal idle result, while a read defect, unavailable server, or deleted project remains an error.

For one-session orchestration, the [agent-board listener procedure](https://github.com/FooQoo/agent-board/blob/main/plugins/agent-board/skills/agent-board/references/listening.md) describes task enrichment, approval checks, waiting for answers, sequential work, and interruption recovery. An open question blocks that session until it is answered or withdrawn; listener mode does not skip it or treat its time as idle.

## Automatic Done

The rule is defined in [Data model](./history-and-decisions.md#acceptance-conditions-and-automatic-done). Evaluation works like this:

- It re-reads the latest `TASK.md` and task fields under the FileStore project lock and applies one shared eligibility check.
- `serve` evaluates existing tasks at startup, before publishing the first snapshot. During operation it evaluates after FileStore saves and after atomic file updates seen by the watcher. It never re-triggers from its own notification, and re-evaluating the same task never duplicates history.
- A CLI edit that also changes the epic is evaluated after all changes apply. AI-facing CLI and FileStore entry points apply the Done guard.
- Tasks that wait for a person are skipped and re-evaluated after the answer. Done tasks never reopen automatically.
- Automatic Done needs a running server. The hook starts one, and a watcher-seen file change counts as use, so an automatic server does not stop while an agent keeps editing.
- Agents record verification in history, put concise results in the body, and only then set the last condition to `done: true`.
- Starting a new version of `serve` completes existing eligible tasks. Before adopting it for normal use, list those tasks and take a backup.

This restrains cooperative agents; it does not authenticate against direct file edits or a spoofed actor.

## Sample cards of the first-run guide

The first-run guide creates two sample cards. Each carries an `onboardingSample` identity, which holds the run ID and the ordinal (1 or 2). The progress table, the hook, and `wait --until task` leave out every card with this identity, whatever its lane or run state, so an agent never picks one up.

Only the guide writes the identity. Create and edit requests have no field for it, and moves, history updates, archiving, and restoring keep it. The board still shows the cards. For what the user sees, see [Before you start](../../guide/quickstart.md#before-you-start-the-first-run-guide).

## The plugin

The Skill and the Hook are distributed as one plugin, `agent-board`, from a marketplace in this repository. Both agents install it with their own plugin commands, so agboard embeds no copy of the files.

| Path | Contents |
| --- | --- |
| `.agents/plugins/marketplace.json` | The Codex marketplace catalog, named `agent-board`. |
| `.claude-plugin/marketplace.json` | The Claude Code marketplace catalog, named `agent-board`. |
| `plugins/agent-board/.codex-plugin/plugin.json`<br>`plugins/agent-board/.claude-plugin/plugin.json` | The plugin manifests. |
| `plugins/agent-board/skills/agent-board/` | The Skill: `SKILL.md`, `references/`, and `assets/`. |
| `plugins/agent-board/hooks/codex.json`<br>`plugins/agent-board/hooks/claude.json` | The Hook of each agent. |

The plugin versions in both manifests and the `--plugin-version` in both Hook commands equal the crate version. `tests/plugin_layout.rs` and `scripts/release/check-version.py` check this, so a release tag always holds a plugin of the same version as the binary.

## Hook skip and errors

The Hook resolves the project with `FileStore::resolve_binding`, which returns a `ResolvedBinding` (the project and the bound root). `project_for_folder` calls it, so ordinary commands keep their `folder_unbound` error.

| Input or state | Behavior |
| --- | --- |
| The `cwd` is a bound root, a subfolder, or inside a nearer nested binding | The nearest project only, as `AGBOARD_PROGRESS`. |
| The bindings are valid, the `cwd` is readable, and no binding matches | Nothing on stdout or stderr, exit code 0. The board is not read. |
| The nearest binding names a project that is gone | `bound_project_missing`. It never falls back to a parent. |
| The bindings file is malformed or unreadable | `AGBOARD_ERROR` with the cause. It is not treated as unbound. |
| The input is not valid JSON, has the wrong type, or is too large | `invalid_hook_input`, as before. |
| The `cwd` is missing, `null`, or empty | The process working folder is used. |
| The `cwd` is not a string, or is a relative path | `invalid_hook_input`. |
| The `cwd` does not exist or cannot be read | `hook_cwd_unavailable`. It is never turned into a skip. |
| An explicit `--project` | The named project wins. A name that is not found is `project_not_found`. |

The 64 KiB input, 256 KiB table, 10 second limit, event allowlist, and fixed command stay. The Hook never uses the network or writes settings. Starting the server is the one side effect it has, and its only notice is the [version check](#the-plugin-version-check) at session start.

## The plugin version check

The Hook command names the plugin's version with `--plugin-version`. `src/agent/hook_version.rs` compares it with the version of the running `agboard`. When they differ, the SessionStart output gets an `AGBOARD_NOTICE` that tells the agent to ask the user to run `agboard update` and start a new session. Other events never carry the notice, so it appears once per session. The check reads and writes nothing, and ordinary commands print no update notice.

## Setup and update

`agboard setup` and `agboard update` share `src/setup/`, and `src/cli/commands/setup.rs` handles both. They branch before normal store handling, need no project, and resolve the data area once through the shared path resolution. For what users see, see [Set up your agents](../../guide/automation/agents.md#set-up-your-agents) and [Setup and update](../../guide/automation/cli.md#setup-and-update).

A run has two phases:

1. **Prepare (read-only).** `prepare.rs` finds each agent's command on `PATH`, reads the installed plugin version with `plugin list --json`, and, for `setup`, reads and plans the settings files. An agent whose command is missing is skipped with the reason. `update` skips an agent that has no plugin. A settings file that cannot be used stops the whole run before anything is written. A dry run stops after this phase, so it uses the same checks.
2. **Execute.** After the user agrees, `execute.rs` creates the shared folder and writes the settings files, all or none. It then runs each agent's plugin commands and, for Codex, trusts the hooks. A failure in this step stops only that agent; the files already written stay, because they are correct on their own and the command can be run again.

The pieces:

- **Agent commands.** `agent_cli.rs` finds `codex` and `claude` on `PATH` without a shell, runs them with no input and a time limit, and captures their output. Tests put fake commands first on `PATH` (`tests/support/fake_agents.rs`), so no test reaches a real agent or the network.
- **Plugin install.** `plugin.rs` adds the marketplace at the tag `v<version>` of `https://github.com/FooQoo/agent-board.git`, then runs `codex plugin add agent-board@agent-board`, or `claude plugin install` and `claude plugin update`. When the marketplace was already added from another source (Codex reports that it is added from a different source; Claude Code reports the failure code `declared`), it removes the marketplace and adds it again. This is how both agents move a marketplace to a new tag. `AGBOARD_PLUGIN_MARKETPLACE` replaces the source with another location, such as a local checkout, for development.
- **Settings files.** `plan.rs`, `codex.rs`, and `claude.rs` compute the new bytes of each file. Codex TOML is edited with `toml_edit`, preserving comments, other keys, and arrays; Claude Code JSON keeps unknown keys. Codex gets the data folder in `sandbox_workspace_write.writable_roots` and the rules file `$CODEX_HOME/rules/agboard.rules`; Claude Code gets it in `permissions.additionalDirectories`. `update` changes no settings file.
- **Writing.** `apply.rs` and `apply/files.rs` back up each existing file to `<file>.agboard-backup…` in the same folder, replace it through a temporary file and a rename, and undo what this run wrote when a later write fails. A file that changed after planning is never overwritten. Symbolic links are resolved and the real file is edited.
- **Hook trust.** `trust.rs` starts `codex app-server`, lists the hooks with `hooks/list`, and stores the current hash of each Agent Board hook under `hooks.state` with `config/value/write`. Only the plugin's own hooks are touched. Codex ties trust to the plugin's content, so every install or update trusts the hooks again.
- **Report.** `report.rs` gives each agent `updated`, `unchanged`, `planned`, `skipped`, or `failed`, as text or JSON. The exit code is 1 when an agent failed, or when `setup` could set up no agent.

Setup never switches permission modes or managed settings. What it may and may not grant is part of the [Security model](./security.md#agent-access-setup).
