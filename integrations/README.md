# Claude Code and Codex integration

For browser operations, CLI examples, and shared-file editing, see the [usage guide](https://fooqoo.github.io/agent-board/guide/), in particular [CLI reference](https://fooqoo.github.io/agent-board/guide/automation/cli) and [Editing and image attachments](https://fooqoo.github.io/agent-board/guide/use/editing).

Agent Board hooks read the same read-only progress table as `agboard progress --json` after tools run and pass it to the agent as `additionalContext`. The `agent-board` skill describes how to choose work from that table, read only the needed plan and task files, record work, and verify acceptance conditions.

## Resolve the project from the working folder

Hook templates use a fixed command such as `agboard hook --agent claude`; they contain no project name, session ID, shell variables, or substitutions. The hook reads `cwd` from its JSON input and resolves the nearest registered ancestor folder. If `cwd` is absent, it uses the hook process's current folder. An explicit `--project NAME` overrides folder bindings. A folder with no binding at all produces no output and exit code 0, so a Global Hook does not disturb other folders. A malformed binding, a deleted bound project, or an unreadable `cwd` produces `AGBOARD_ERROR`; the hook never guesses another project.

The `AGBOARD_PROGRESS` payload contains project metadata, versions, paths to each epic `PLAN.md` and task `TASK.md`, and each eligible task's ID, title, owner, status, and acceptance count. It excludes Done, archived, and Pending tasks, and omits bodies, history, and image data. Human-owned and draft tasks remain visible; do not take work assigned to a person or a draft. Read only the plan and task files needed for the selected work. If the complete progress table exceeds 256 KiB or cannot be read, the agent gets `AGBOARD_ERROR` and must not make board-dependent changes. The hook never truncates the table and never blocks or changes the original tool result.

Image attachments follow the same project and task boundaries. Use `agboard --project NAME attachment add <task-id> --file PATH --actor ai|human` to add an image, `agboard --project NAME attachment ls <task-id>` to read metadata, and `agboard --project NAME attachment get <task-id> <attachment-id> --output PATH` to retrieve bytes. Snapshot and wait payloads contain attachment metadata only; progress and hook payloads omit attachments. Image bytes are returned only by `get`. Draft tasks, invalid or oversized image files, and tasks outside the named project are rejected. Retrieval never overwrites an existing output file.

## Choose scopes

Run `agboard connect` in a folder bound to a project. It installs the `agent-board` Skill and the Hook for Claude Code, Codex, or both, and the Hook templates in this folder are what it installs. Skill scope and Hook scope are independent: you choose Global or Project once for the Skill and once for the Hook, and the choice applies to every agent you selected. See [Working with agents](https://fooqoo.github.io/agent-board/guide/automation/agents#connect-your-agent) for the questions, and [Install and start](https://fooqoo.github.io/agent-board/guide/getting-started) for the whole path (Homebrew, `project create` or `project bind`, `connect`, `serve`).

| Agent | Component | Global | Project |
| --- | --- | --- | --- |
| Claude Code | Skill | `~/.claude/skills/agent-board/` | `<bound-root>/.claude/skills/agent-board/` |
| Claude Code | Hook | `~/.claude/settings.json` | `<bound-root>/.claude/settings.json` |
| Codex | Skill | `~/.agents/skills/agent-board/` | `<bound-root>/.agents/skills/agent-board/` |
| Codex | Hook | `~/.codex/hooks.json` | `<bound-root>/.codex/hooks.json` |

`<bound-root>` is the root of the nearest binding. `CLAUDE_CONFIG_DIR` and `CODEX_HOME` move the Global paths of Claude Code and the Codex Hook. A Global Hook also runs in folders with no project; there it prints nothing and exits normally.

`connect` merges only its own entries into your settings, shows every change first, keeps a backup of each file it changes, and stops for an unmanaged equal Hook or a file you edited. Hooks and the Skill run `agboard` from `PATH`, so they use the installed version. `connect` and `update` are in [public preview](https://fooqoo.github.io/agent-board/guide/feature-stages#connect-and-update).

## Trust hooks

After `connect` finishes, start a new Claude Code session, or restart Codex, and review the Hook with `/hooks` before you trust it. An untrusted Hook does not run. Check the project binding from the working folder with `agboard progress --json`.

## Refresh integrations

After `brew upgrade fooqoo/tap/agboard`, run `agboard update` (or `agboard update --yes`, which skips only the question). It updates what `connect` recorded, for the Global installations and the nearest bound root's Project installations, and never overwrites an edit of yours. After a Hook changes, trust it again in `/hooks`.

## Rules for agents on the shared files

The project folder holds plain files that the CLI and the browser read. Agents may read them at any time. Agents may edit only these, and only as the folder's README allows:

- A task's `TASK.md`, to record its plan and verification results in the body and to set its completion conditions (`done`) in the frontmatter. Operation history is recorded by the CLI; do not write a chronological log in the body. Never edit the `TASK.md` of a draft task (`"isDraft": true`); wait until the user finalizes it.
- An epic's `PLAN.md`.

Never edit `task.json`, `epic.json`, or `project.json` directly; use the `agboard` CLI for every change to a task, an epic, or a project. Never delete a task folder or an epic folder: ask a person to delete a task or an epic with the CLI. Do not put a machine-specific absolute path into a shared file.

Keep your own settings. `connect` merges its entries into existing settings and does not replace a settings file that contains other hooks; if you register a Hook by hand instead, merge the template and keep the others. `agboard setup` and `connect` change user-level agent settings only to add the data folder. If `agboard` is not on the agent's `PATH`, fix your `PATH`; do not copy a machine-specific absolute path into a shared file.

Done tasks are read-only for agents and do not return to progress unless a user reopens them. Pending tasks also stay out of the progress table until answered; their questions are kept on the board. Use `show <id> --json` for a known waiting task or `snapshot --json` to inspect all current questions, then `wait` when no work can proceed. Do not infer that a question expired because it is absent from progress.

## Claude Code

`connect` writes the entries of `integrations/claude-code/settings.json` into the Hook file of the scope you chose (by hand, merge them into `.claude/settings.json`). It registers the fixed command for:

- `SessionStart` (startup, resume, clear, compact): the first progress table and the table after compaction.
- `PostToolUse`: a fresh progress table after each tool.
- `PostToolUseFailure`: a fresh progress table after a failed tool.

Inspect `/hooks` and review the fixed command before trusting it. The generic `agent-board` skill does not register hooks itself.

## Codex CLI and Codex App

1. `connect` writes the entries of `integrations/codex/hooks.json` into the Hook file of the scope you chose (by hand, merge them into `.codex/hooks.json` and keep existing hooks).
2. Start Codex in the project and review/trust the hook definitions in `/hooks`.
3. The templates set `additionalContextLimit` to `0` so that the 256 KiB check done by `agboard` is the only limit. SessionStart refreshes progress after startup, resume, clear, or compact; PostToolUse refreshes it after tools.

## After renaming a project

A rename keeps the project's ID and its folder bindings. If you explicitly pass `--project`, use the new name. A project created later with the former name is a different project.

## Waiting for a user response

When no work can proceed, read the snapshot of your project and use its `cursor`:

```sh
agboard --project "My project" snapshot --json
agboard --project "My project" wait --after <cursor> --json
```

`wait` resolves the project name once, checks that the cursor belongs to that project, and then follows that same project. Changes to other projects do not end it. If the project is renamed while waiting, it keeps following the same project and returns its latest snapshot. If the project is deleted it fails with `project_not_found`, and it never switches to a project created later with the same name. It listens for a local board-change event from a running `agboard serve` in the same data area; it does not poll or update tasks. When it returns, read the full snapshot and history, reconsider the user's reason, then resume or ask a follow-up question.

`wait_timeout`, `board_unavailable`, `cursor_invalid`, and `project_not_found` are errors, not answers.

## Verification status

The repository tests exercise the hook payloads and the wait/SSE round trip with a real local server and temporary data. They do not prove that a particular Claude Code or Codex installation trusted the hook or delivered the entire context to a model. Complete the in-session check for your installed agent after reviewing the hook in `/hooks`. The Codex App cannot be checked automatically; verify it by hand.
