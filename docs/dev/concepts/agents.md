# Agent integration

Agents use Agent Board through three pieces: the skill that tells them how to work, the hook that hands them the progress table, and `wait` that lets them block until a person answers. This page explains each piece and what `agboard setup` prepares. The user-facing workflow is in [Working with agents](../../guide/automation/agents.md); the JSON they receive is in [Hook, progress, and wait output](../reference/agent-output.md).

## How the pieces fit together

| Piece | Lives in | Job |
| --- | --- | --- |
| Skill `agent-board` | `.agents/skills/agent-board/SKILL.md` | Judgment: how to choose work, report progress, ask decisions, and respect drafts and Done tasks. |
| Hook | `agboard hook` (`src/agent/hook.rs`) | Fetching and formatting: after tool calls, attach the current progress table to the agent's context. |
| Progress table | `src/progress.rs` | The list of workable tasks, shared by `agboard progress` and the hook. |
| `wait` | `src/agent/wait.rs` | Block until the project changes or a decision is answered. |

The skill is named `agent-board`; the executable is `agboard`. A typical loop: the hook shows the progress table → the agent reads only the `EPIC.md` and `TASK.md` it needs → it clarifies an unclear title through `agboard edit --title`, preserving the original request → it moves the task to Doing and Running → it records progress with `history add` → it asks a decision and waits by default when blocked → it checks conditions off, and automatic Done finishes the task. Title refinement is a skill instruction shared by the ordinary loop and listener, not a server-side summarization feature.

Agents append progress at the start, meaningful progress, decisions, verification, interruptions, and resumptions, without per-entry approval, and never duplicate entries that operations already appended. The body keeps the plan and concise verification results. Images can be attached when visual proof is useful.

The skill gives `BUG` and `ENHANCEMENT` a fixed-body exception: they are ongoing classification epics, not per-feature plans. Their canonical bodies live in `assets/BUG-EPIC.md` and `assets/ENHANCEMENT-EPIC.md` beside the skill. After one-time initialization in the board’s language, normal work and listener runs record plans and outcomes only on tasks. An explicit user request is required to replace existing non-empty content, with useful old content retained in relevant task bodies. Priority frontmatter remains editable. This is not a server-side edit restriction.

## The progress table and the hook

The progress table lists non-Pending Todo and Doing tasks, grouped by epic in `priority` order, with each task's ID, title, owner, status, acceptance counts, and the paths of its `EPIC.md` and `TASK.md`. It never includes bodies or history. A Pending task higher in the order does not block lower tasks, and an answered task that is still unfinished returns to the table.

`src/progress.rs` builds the optional `pending` and `done` sections from `Include`, which `agboard progress` and `agboard hook` fill from `--include-pending` and `--include-done`. The default `Include` adds nothing, so the default table is unchanged. See [Epics and progress](../../guide/use/epics.md#read-the-progress-table) for the options.

The hook identifies the project from the nearest bound ancestor of the input `cwd` (or the process cwd), never from a session ID, and never selects all projects when the folder is unbound, and never falls back to a parent when the nearest binding is broken. It returns the table as `AGBOARD_PROGRESS` JSON in `hookSpecificOutput.additionalContext`, or an `AGBOARD_ERROR` such as `bound_project_missing`. A folder with no binding at all is not an error; see [Hook skip and errors](#hook-skip-and-errors).

- **Claude Code.** The template in `integrations/claude-code/` registers `agboard hook` on PostToolUse, and on PostToolUseFailure after failures, without a fixed project name. Generic skill frontmatter hooks are not used. The skill reads a snapshot when first loaded; the table is fetched again after compaction (SessionStart `compact`) or on the next tool completion.
- **Codex.** The template in `integrations/codex/` registers `agboard hook --agent codex` on PostToolUse and also fetches at first use and after compaction. Existing settings are never written automatically; users review and trust the template.
- **Limits.** Input is limited to 64 KiB of UTF-8, the table to 256 KiB, and a run to 10 seconds. Codex's `additionalContextLimit` is set to 0 so the hook enforces its own limit. Exceeding it reports `context_too_large`; output is never truncated and reported as success. When the table cannot be produced or the full input did not arrive, the hook says so and keeps the original tool result.
- **Safety.** Commands are fixed; nothing is built from task text or `tool_input`. The hook never calls agent tools, never triggers itself, and never changes files. Paths appear only in local CLI and hook output, never in remote JSON.

Agents make no board-dependent changes until the table can be read, and they read a fresh table after context compaction.

The skill requires all task-related questions to use board decision requests with choices. `pending --request-json` waits indefinitely by default, even when `wait` is omitted; `wait: {}` remains compatible. The skill uses `--no-wait` only when the user explicitly asks to register a question and return immediately. It forbids substituting chat or native agent question tools, including when the board is unavailable.

## Waiting for changes

`agboard wait --after <cursor>` blocks until the project changes:

1. Read `pid` and `port` from `serve.json` in the same data area and connect to `GET /api/events`.
2. Match the project name against the cursor and fix the ProjectId. A cursor for another project, or in an old format, is `cursor_invalid`.
3. After `ready`, compare the project's current version with the cursor. If they differ, return at once; this catches changes made between fetching and subscribing.
4. Otherwise wait for `changed`. If a re-read shows the same version (another project changed), keep waiting.

- `changed`, `ready`, and keep-alive comments are distinguished. Renames return the same project's snapshot; deletion returns `project_not_found` and never moves to a re-created project.
- The connection limit is 3 seconds, and the wait itself is unlimited by default. With an optional `--timeout`, it checks the version once more at the end and returns `wait_timeout` if nothing changed. A disconnect returns `board_unavailable`. There are no automatic short retries and no periodic polling.
- Disconnects, timeouts, and Ctrl+C never change tasks or history, never count as "no change", and never restart a finished agent.
- Because CLI notifications are best effort, a missed one is caught on the next connection, a real `changed`, or the final read at a timeout.

**Decision requests** are saved before the CLI notifies `serve` and waits on the existing SSE event stream. The default wait needs a running `serve`; a preflight check runs before the save, so an unavailable server does not create the question. Omitting `wait` and using `wait: {}` both wait indefinitely; an integer `timeoutSeconds` from 1 to 86,400 limits only that CLI process. `wait: null` and `timeoutSeconds: null` mean no timeout. The wait settings are not saved with the task.

On success, the waiting command returns `{task, answer}`; `--no-wait` returns `{task}` after saving and notifying and does not need `serve`. It can be combined with `wait: {}`, but not an integer timeout. A timeout, interruption, or lost connection leaves the question Pending; `request_changed` means it was withdrawn. After a browser answer the task becomes Idle; the agent reads the answer and history, then explicitly resumes Running with a reason. See [Decision requests](../../guide/use/decisions.md) for the user workflow.

### Waiting for the next task

`agboard --project <name> wait --until task --idle-timeout <seconds> --json` uses the same event-driven wait engine. It reads eligible tasks immediately before subscribing, checks again after the SSE `ready`, and checks after each `changed` event. A single monotonic deadline starts when the initial snapshot has no eligible task; unrelated project changes and keep-alives do not extend it. At the deadline it reads once more, returning a task if one arrived at the boundary, otherwise `idle_timeout` with exit code 0.

The selector uses `ordered_tasks`, the same ordering as the progress table: epics sorted by ID, each epic's saved task priority and then task ID, followed by ungrouped tasks by ID. It returns one AI-owned Todo or Doing task whose run state is Idle, provided it is not a draft or archived. The initial read means tasks created before listening are eligible. The result contains the snapshot cursor, the task, its local `TASK.md` path, and its `EPIC.md` path when it has an epic. Selection is read-only and does not claim a task; callers must re-read its state before acting. The listener procedure checks the complete snapshot first and resolves any existing AI work in `running` or `pending`; an idle task in Doing is eligible to resume. A timeout is a normal idle result, while a read defect, unavailable server, or deleted project remains an error.

For one-session orchestration, the [agent-board listener procedure](https://github.com/FooQoo/agent-board/blob/main/.agents/skills/agent-board/references/listening.md) describes task enrichment, approval checks, Pending answers, sequential work, and interruption recovery. A Pending task blocks that session until its existing request is answered; listener mode does not skip it or treat its time as idle.

## Automatic Done

The rule is defined in [Data model](./history-and-decisions.md#acceptance-conditions-and-automatic-done). Evaluation works like this:

- It re-reads the latest `TASK.md` and task fields under the FileStore project lock and applies one shared eligibility check.
- `serve` evaluates existing tasks at startup, before publishing the first snapshot. During operation it evaluates after FileStore saves and after atomic file updates seen by the watcher. It never re-triggers from its own notification, and re-evaluating the same task never duplicates history.
- A CLI edit that also changes the epic is evaluated after all changes apply. AI-facing CLI and FileStore entry points apply the Done guard.
- Pending tasks are skipped and re-evaluated after the answer. Done tasks never reopen automatically.
- Agents record verification in history, put concise results in the body, and only then set the last condition to `done: true`.
- Starting a new version of `serve` completes existing eligible tasks. Before adopting it for normal use, list those tasks and take a backup.

This restrains cooperative agents; it does not authenticate against direct file edits or a spoofed actor.

## Sample cards of the first-run guide

The first-run guide creates two sample cards. Each carries an `onboardingSample` identity, which holds the run ID and the ordinal (1 or 2). The progress table, the hook, and `wait --until task` leave out every card with this identity, whatever its lane or run state, so an agent never picks one up.

Only the guide writes the identity. Create and edit requests have no field for it, and moves, history updates, archiving, and restoring keep it. The board still shows the cards. For what the user sees, see [Before you start](../../guide/quickstart.md#before-you-start-the-first-run-guide).

## Embedded bundle

`connect` and `update` need no Git clone, Node.js, or Rust at run time, because the Skill and the Hook templates are inside the binary.

- **What is embedded.** `build.rs` (with `src/integrations/build_bundle.rs`) takes an allowlist: `SKILL.md`, `references/`, and `assets/` of `.agents/skills/agent-board/`, and the Hook JSON of `integrations/claude-code/` and `integrations/codex/`. It rejects dangling references, personal absolute paths, and symbolic links, and never reads `node_modules`. `assets::bundle()` returns an `EmbeddedBundle` with the crate version and, for each entry, a relative path, the bytes, and their SHA-256. If the Skill folder is missing, the build warns and embeds nothing; `connect` and `update` then fail at run time, so check the embedded file count of a release build.
- **Where it is placed.** `paths.rs` holds pure functions from the environment (`AGBOARD_HOME`, `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, the home folder) and the bound root to the four targets in [Choose scopes](../../guide/automation/agents.md#choose-scopes). The Claude Code Global Skill follows `CLAUDE_CONFIG_DIR`. The Codex Skill uses `~/.agents/skills` and ignores `CODEX_HOME`. An empty variable counts as unset. Project paths start from the bound root that `FileStore::resolve_binding` returns, never from the working folder.
- **The registry.** `registry.rs` reads and writes `<data-dir>/integrations.json`, `schemaVersion` 1. Anything else, or a record that breaks the rules, is refused and never migrated or rewritten. The fields are in [Shared files](../reference/files.md#integration-records).
- **Hashes.** A file's hash is the SHA-256 of its bytes, in lowercase hex. A Skill's managed hash is the SHA-256 of one line `path<TAB>sha256<LF>` per file, in path order. A Hook entry's hash is the SHA-256 of the canonical JSON of its `hooks[event][i]` group (keys sorted at every level, no whitespace). The Hook's managed hash is the SHA-256 of one line `event<TAB>matcher<TAB>command<TAB>sha256<LF>` per entry, with an empty matcher when there is none. A hash of a whole settings file is used only to notice a change during the run. A change to a key that is not Agent Board's is never a conflict.

The hashes find accidental overwrites and edits. They do not authenticate where the files came from, and they do not replace the signature of the distributed binary.

## Plan and apply

`connect` and `update` share one engine in `src/integrations/`, so the ownership and conflict rules cannot differ.

1. **Plan (read-only).** `plan::plan_agent` builds an `AgentPlan` for one agent: the operations, what is added or removed, the permission edits, conflicts, manual steps, and warnings. Its state is `Ready`, `Unchanged`, or `Blocked`. `connect` plans with permissions and the scope the user chose. `update` plans only the recorded targets, with permissions off.
2. **Ownership.** A Hook is identified by agent, event, matcher, and the normalized fixed command. Edited or missing managed entries, an unmanaged equal Hook, and an `agboard` command that cannot be identified each block the agent. The scan covers the Global files, the bound root and its ancestors (`settings.json` and `settings.local.json`, or `hooks.json` and `config.toml`, including Codex inline hooks), and the Project paths in the registry. It never walks the disk. A Skill is a conflict when a managed file was edited or removed, a file was added, or a link replaced a file.
3. **Apply.** `apply::apply_agent` runs one agent at a time, Claude Code before Codex, so one failure never undoes the other. For each agent it takes a lock (`integrations-<agent>.lock`, which fails at once if held), refuses to start while a journal exists, validates every target, writes a journal that holds the original and planned hashes and the backup names, backs up each changed file as `<name>.agboard-backup-<txn>-<index>`, writes the new content to a temporary file or folder on the same filesystem, replaces the original atomically, and commits the registry last. A Skill folder is finished in a staging folder before it replaces the old one.
4. **Result.** Each agent ends as `Applied`, `Unchanged`, `Blocked`, `Failed`, or `Interrupted`. A failure rolls that agent back to its start without overwriting a file that someone else changed; if that is not possible, the journal stays.
5. **Recovery.** `recovery::recover_pending` is called by `connect` and `update` before they plan. It compares the journal, the original and new hashes, and the backups, then restores what is safe and stops, naming the files, when it is not. Ordinary commands and the Hook never recover and never write settings.

An unreadable or unknown registry stops both commands with the reason. For what users do about conflicts and backups, see [Working with agents](../../guide/automation/agents.md#connect-your-agent) and [Data and backups](../../guide/operations/data.md#integration-records-backups-and-manual-permissions).

## Hook skip and errors

The Hook resolves the project with `FileStore::resolve_binding`, which returns a `ResolvedBinding` (the project and the bound root). `project_for_folder` calls it, so ordinary commands keep their `folder_unbound` error.

| Input or state | Behavior |
| --- | --- |
| The `cwd` is a bound root, a subfolder, or inside a nearer nested binding | The nearest project only, as `AGBOARD_PROGRESS`. |
| The bindings are valid, the `cwd` is readable, and no binding matches | Nothing on stdout or stderr, exit code 0. The board and the registry are not read. |
| The nearest binding names a project that is gone | `bound_project_missing`. It never falls back to a parent. |
| The bindings file is malformed or unreadable | `AGBOARD_ERROR` with the cause. It is not treated as unbound. |
| The input is not valid JSON, has the wrong type, or is too large | `invalid_hook_input`, as before. |
| The `cwd` is missing, `null`, or empty | The process working folder is used. |
| The `cwd` is not a string, or is a relative path | `invalid_hook_input`. |
| The `cwd` does not exist or cannot be read | `hook_cwd_unavailable`. It is never turned into a skip. |
| An explicit `--project` | The named project wins. A name that is not found is `project_not_found`. |

The 64 KiB input, 256 KiB table, 10 second limit, event allowlist, and fixed command stay. The Hook never shows an update notice, recovers a settings file, uses the network, or writes settings.

## The update notice

After an ordinary command prints its output, `notice::stale_line` may print one line to stderr. It compares the `installedVersion` of the records `update` would touch (Global, and the nearest bound root's Project) with this build's version. It scans no asset, uses no network, and writes nothing. It prints only when stdout and stderr are both terminals and the output is not JSON. `hook`, `wait`, `serve`, `stop`, `setup`, `connect`, `update`, help, and version return before it. A missing, unreadable, or unknown registry means no notice and no change to the command's output or exit code; `update` is where such a problem is reported. The text is in [Working with agents](../../guide/automation/agents.md#refresh-the-integrations).

## Preparing access with setup

`agboard setup` adds the Agent Board data area to the agents' allowed folders so they can edit shared files. It is a one-time step the user runs; it never creates projects or registers hooks. `agboard connect` makes the same permission change and also installs the Skill and the Hook.

How it is built:

- It branches before normal store handling and resolves the data area once through the shared path resolution.
- Environment and path resolution, the change plan, Codex TOML editing (`toml_edit`, preserving comments, other keys, and arrays), Claude Code JSON editing (preserving unknown keys), and backup and apply are separate steps. The change plan holds each file's original and updated content; dry runs use the same validation.
- It never switches permission modes or managed settings. It checks whether the change is possible under the current scheme, validates every target before writing, and confirms originals did not change meanwhile. Writing a file is reported separately from an agent loading it.

When something fails:

- Invalid JSON or TOML, an unsupported permission scheme, or a concurrent change stops setup before anything is written, with the target, reason, and next step.
- Each file to change is backed up to a unique file in the same folder, then replaced from a temporary file. Unchanged files are neither backed up nor written.
- If a run fails partway, only what that run wrote is restored, without overwriting external changes. If restoring is impossible, the run is not reported as complete; it states what changed and where the backups are.
- Symbolic links are resolved and the real file is edited. Unresolvable paths stop setup instead of guessing.
- A dry run creates no folders, settings files, or backups. Setup never changes old data or a running server's notification target.

What it may and may not grant is part of the [Security model](./security.md#agent-access-setup).
