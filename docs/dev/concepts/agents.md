# Agent integration

Agents use Agent Board through three pieces: the skill that tells them how to work, the hook that hands them the progress table, and `wait` that lets them block until a person answers. This page explains each piece and what `agboard setup` prepares. The user-facing workflow is in [Working with agents](../../guide/automation/agents.md); the JSON they receive is in [Hook, progress, and wait output](../reference/agent-output.md).

## How the pieces fit together

| Piece | Lives in | Job |
| --- | --- | --- |
| Skill `agent-board` | `.agents/skills/agent-board/SKILL.md` | Judgment: how to choose work, report progress, ask decisions, and respect drafts and Done tasks. |
| Hook | `agboard hook` (`src/agent/hook.rs`) | Fetching and formatting: after tool calls, attach the current progress table to the agent's context. |
| Progress table | `src/progress.rs` | The list of workable tasks, shared by `agboard progress` and the hook. |
| `wait` | `src/agent/wait.rs` | Block until the project changes or a decision is answered. |

The skill is named `agent-board`; the executable is `agboard`. A typical loop: the hook shows the progress table → the agent reads only the `PLAN.md` and `TASK.md` it needs → it moves the task to Doing and Running → it records progress with `history add` → it asks a decision with `"wait": {}` when blocked → it checks conditions off, and automatic Done finishes the task.

Agents append progress at the start, meaningful progress, decisions, verification, interruptions, and resumptions, without per-entry approval, and never duplicate entries that operations already appended. The body keeps the plan, results, and evidence references; full logs go to evidence files.

## The progress table and the hook

The progress table lists non-Pending Todo and Doing tasks, grouped by epic in `priority` order, with each task's ID, title, owner, status, acceptance counts, and the paths of its `PLAN.md` and `TASK.md`. It never includes bodies or history. A Pending task higher in the order does not block lower tasks, and an answered task that is still unfinished returns to the table.

The hook identifies the project from the nearest bound ancestor of the input `cwd` (or the process cwd), never from a session ID, and never selects all projects when the folder is unbound. It returns the table as `AGBOARD_PROGRESS` JSON in `hookSpecificOutput.additionalContext`, or an `AGBOARD_ERROR` such as `folder_unbound`.

- **Claude Code.** The template in `integrations/claude-code/` registers `agboard hook` on PostToolUse, and on PostToolUseFailure after failures, without a fixed project name. Generic skill frontmatter hooks are not used. The skill reads a snapshot when first loaded; the table is fetched again after compaction (SessionStart `compact`) or on the next tool completion.
- **Codex.** The template in `integrations/codex/` registers `agboard hook --agent codex` on PostToolUse and also fetches at first use and after compaction. Existing settings are never written automatically; users review and trust the template.
- **Limits.** Input is limited to 64 KiB of UTF-8, the table to 256 KiB, and a run to 10 seconds. Codex's `additionalContextLimit` is set to 0 so the hook enforces its own limit. Exceeding it reports `context_too_large`; output is never truncated and reported as success. When the table cannot be produced or the full input did not arrive, the hook says so and keeps the original tool result.
- **Safety.** Commands are fixed; nothing is built from task text or `tool_input`. The hook never calls agent tools, never triggers itself, and never changes files. Paths appear only in local CLI and hook output, never in remote JSON.

Agents make no board-dependent changes until the table can be read, and they read a fresh table after context compaction.

The skill requires all task-related questions to use board decision requests, with choices and `"wait": {}` by default. It forbids substituting chat or native agent question tools, including when the board is unavailable. The CLI still supports non-waiting requests; only an explicit user instruction opts out of waiting in the skill workflow.

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

**Decision requests with `"wait": {}`** ask and wait in one command. The question stays Pending until it is answered or a lane move withdraws it (`request_changed`); ending or interrupting the wait never expires it. The waiting command returns the resolved answer as `answer`. The local wait client does not follow HTTP redirects and connects only to the same `serve` on 127.0.0.1.

### Waiting for the next task

`agboard --project <name> wait --until task --idle-timeout <seconds> --json` uses the same event-driven wait engine. It reads eligible tasks immediately before subscribing, checks again after the SSE `ready`, and checks after each `changed` event. A single monotonic deadline starts when the initial snapshot has no eligible task; unrelated project changes and keep-alives do not extend it. At the deadline it reads once more, returning a task if one arrived at the boundary, otherwise `idle_timeout` with exit code 0.

The selector uses `ordered_tasks`, the same ordering as the progress table: epics sorted by ID, each epic's saved task priority and then task ID, followed by ungrouped tasks by ID. It returns one AI-owned Todo or Doing task whose run state is Idle, provided it is not a draft or archived. The initial read means tasks created before listening are eligible. The result contains the snapshot cursor, the task, its local `TASK.md` path, and its `PLAN.md` path when it has an epic. Selection is read-only and does not claim a task; callers must re-read its state before acting. The listener procedure checks the complete snapshot first and resolves any existing AI work in `running` or `pending`; an idle task in Doing is eligible to resume. A timeout is a normal idle result, while a read defect, unavailable server, or deleted project remains an error.

For one-session orchestration, the [agent-board listener procedure](https://github.com/FooQoo/agent-board/blob/main/.agents/skills/agent-board/references/listening.md) describes task enrichment, approval checks, Pending answers, sequential work, and interruption recovery. A Pending task blocks that session until its existing request is answered; listener mode does not skip it or treat its time as idle.

## Automatic Done

The rule is defined in [Data model](./history-and-decisions.md#acceptance-conditions-and-automatic-done). Evaluation works like this:

- It re-reads the latest `TASK.md` and task fields under the FileStore project lock and applies one shared eligibility check.
- `serve` evaluates existing tasks at startup, before publishing the first snapshot. During operation it evaluates after FileStore saves and after atomic file updates seen by the watcher. It never re-triggers from its own notification, and re-evaluating the same task never duplicates history.
- A CLI edit that also changes the epic is evaluated after all changes apply. AI-facing CLI and FileStore entry points apply the Done guard.
- Pending tasks are skipped and re-evaluated after the answer. Done tasks never reopen automatically.
- Agents record verification in history, put results and evidence references in the body, and only then set the last condition to `done: true`.
- Starting a new version of `serve` completes existing eligible tasks. Before adopting it for normal use, list those tasks and take a backup.

This restrains cooperative agents; it does not authenticate against direct file edits or a spoofed actor.

## Preparing access with setup

`agboard setup` adds the Agent Board data area to the agents' allowed folders so they can edit shared files. It is a one-time step the user runs; it never creates projects or registers hooks.

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
