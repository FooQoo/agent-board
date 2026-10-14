# Claude Code and Codex integration

For browser operations, CLI examples, and shared-file editing, see the [usage guide](../docs/usage.md).

Agent Board hooks read the same read-only progress table as `agboard progress --json` after tools run and pass it to the agent as `additionalContext`. The `agent-board` skill describes how to choose work from that table, read only the needed plan and task files, record work, and verify acceptance conditions.

## Resolve the project from the working folder

Hook templates use a fixed command such as `agboard hook --agent claude`; they contain no project name, session ID, shell variables, or substitutions. The hook reads `cwd` from its JSON input and resolves the nearest registered ancestor folder. If `cwd` is absent, it uses the hook process's current folder. An explicit `--project NAME` overrides folder bindings. No binding, a malformed binding, or a deleted bound project produces `AGBOARD_ERROR`; the hook never guesses another project.

The `AGBOARD_PROGRESS` payload contains project metadata, versions, paths to each epic `PLAN.md` and task `TASK.md`, and each eligible card's ID, title, owner, status, and acceptance count. It excludes Done, archived, and Pending cards, and omits bodies, history, and image data. Human-owned and draft cards remain visible; do not take work assigned to a person or a draft. Read only the plan and task files needed for the selected work. If the complete progress table exceeds 256 KiB or cannot be read, the agent gets `AGBOARD_ERROR` and must not make board-dependent changes. The hook never truncates the table and never blocks or changes the original tool result.

Image attachments follow the same project and card boundaries. Use `agboard --project NAME attachment add <card-id> --file PATH --actor ai|human` to add an image, `agboard --project NAME attachment ls <card-id>` to read metadata, and `agboard --project NAME attachment get <card-id> <attachment-id> --output PATH` to retrieve bytes. Snapshot and wait payloads contain attachment metadata only; progress and hook payloads omit attachments. Image bytes are returned only by `get`. Draft cards, invalid or oversized image files, and cards outside the named project are rejected. Retrieval never overwrites an existing output file.

## Before you start

1. Install `agboard` onto your `PATH` (see [Install](../README.md#install)). Hook commands run `agboard` from `PATH`, so they use the installed version, not a development build. Check with `command -v agboard`.
2. From the working repository, create and bind a project with `agboard project create "My project"`, or register an existing project with `agboard project bind "My project"`. Both default to the current folder; `--folder DIR` uses another existing folder. A browser selection does not register a folder for hooks.
3. Run `agboard progress --json` from that folder or a subfolder to confirm it resolves to the intended project. Find the shared files with `agboard --project "My project" workspace --json`; its `folder` is the shared data folder, which is separate from the registered working folder.

## Rules for agents on the shared files

The project folder holds plain files that the CLI and the browser read. Agents may read them at any time. Agents may edit only these, and only as the folder's README allows:

- A card's `TASK.md`, to record its work and to set its completion conditions (`done`) in the frontmatter, and its execution log. Never edit the `TASK.md` of a draft card (`"isDraft": true`); wait until the user finalizes it.
- An epic's `PLAN.md`.

Never edit `task.json`, `epic.json`, or `project.json` directly; use the `agboard` CLI for every change to a card, an epic, or a project. Never delete a card folder or an epic folder: ask a person to delete a card or an epic with the CLI. Do not put a machine-specific absolute path into a shared file.

Keep your own settings. Review the template and merge its hook entries into your project's existing configuration; do not replace a settings file that already contains other hooks. Nothing here writes to your user-level or global agent settings. If `agboard` is not on the agent's `PATH`, fix your `PATH`; do not copy a machine-specific absolute path into a shared file.

Done cards are read-only for agents and do not return to progress unless a user reopens them. Pending cards also stay out of the progress table until answered; their questions are kept on the board. Use `show <id> --json` for a known waiting card or `snapshot --json` to inspect all current questions, then `wait` when no work can proceed. Do not infer that a question expired because it is absent from progress.

## Claude Code

Merge `integrations/claude-code/settings.json` into the project's `.claude/settings.json`. It registers the fixed command for:

- `SessionStart` (startup, resume, clear, compact): the first progress table and the table after compaction.
- `PostToolUse`: a fresh progress table after each tool.
- `PostToolUseFailure`: a fresh progress table after a failed tool.

Inspect `/hooks` and review the fixed command before trusting it. The generic `agent-board` skill does not register hooks itself.

## Codex CLI and Codex App

1. Merge `integrations/codex/hooks.json` into the project's `.codex/hooks.json`; preserve existing hooks.
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

`wait` resolves the project name once, checks that the cursor belongs to that project, and then follows that same project. Changes to other projects do not end it. If the project is renamed while waiting, it keeps following the same project and returns its latest snapshot. If the project is deleted it fails with `project_not_found`, and it never switches to a project created later with the same name. It listens for a local board-change event from a running `agboard serve` in the same data area; it does not poll or update cards. When it returns, read the full snapshot and history, reconsider the user's reason, then resume or ask a follow-up question.

`wait_timeout`, `board_unavailable`, `cursor_invalid`, and `project_not_found` are errors, not answers.

## Verification status

The repository tests exercise the hook payloads and the wait/SSE round trip with a real local server and temporary data. They do not prove that a particular Claude Code or Codex installation trusted the hook or delivered the entire context to a model. Complete the in-session check for your installed agent after reviewing the hook in `/hooks`. The Codex App cannot be checked automatically; verify it by hand.
