# Claude Code and Codex integration

For browser operations, CLI examples, and shared-file editing, see the [usage guide](../docs/usage.md).

Agent Board hooks read one project's complete, read-only snapshot after tools run and pass it to the agent as `additionalContext`. The `agent-board` skill describes how to choose work, add reasons, request a decision, wait for changes, and resume from the user's answer.

## One project per hook

Every hook command names its project with `--project`. The name is fixed in the command: the hook never takes the project from the working directory, the environment, the tool input, the web view, or another agent. A hook without `--project`, or with a name that does not exist, reports `AGBOARD_ERROR` instead of a snapshot.

The payload contains the fetch time, the `project` (ID and name), the `version`, the `cursor`, and every card of that project with its whole history and its full description (Markdown, up to 50,000 characters). A card with `"isDraft": true` is a draft the user is still writing; agents cannot change it (`edit`, `mv`, and `state` fail with `card_is_draft`) and should work on other cards until the user finalizes it. Nothing from another project is included. If the complete snapshot would exceed 256 KiB, or cannot be read, the agent gets `AGBOARD_ERROR` (`context_too_large`, `project_not_found`, `board_unavailable`, ...) and must not make board-dependent changes until a complete snapshot is available. A truncated snapshot is never presented as complete, and the original tool result is never blocked or changed.

Image attachments follow the same project and card boundaries. Use `agboard --project NAME attachment add <card-id> --file PATH --actor ai|human` to add an image, `agboard --project NAME attachment ls <card-id>` to read metadata, and `agboard --project NAME attachment get <card-id> <attachment-id> --output PATH` to retrieve bytes. Snapshot, hook, and wait payloads contain attachment metadata only; image bytes are returned only by `get`. Draft cards, invalid or oversized image files, and cards outside the named project are rejected. Retrieval never overwrites an existing output file.

## Before you start

1. Install `agboard` onto your `PATH` (see [Install](../README.md#install)). Hook commands run `agboard` from `PATH`, so they use the installed version, not a development build. Check with `command -v agboard`.
2. Create the project, or use an existing one: `agboard project create "My project"`.
3. Find the project's folder with `agboard --project "My project" workspace --json`. Its `folder` field is the absolute path, and its `README.md` is the entry point for the files in it.

## Rules for agents on the shared files

The project folder holds plain files that the CLI and the browser read. Agents may read them at any time. Agents may edit only these, and only as the folder's README allows:

- A card's `TASK.md`, to record its work, its completion conditions and results, and its execution log. Never edit the `TASK.md` of a draft card (`"isDraft": true`); wait until the user finalizes it.
- An epic's `PLAN.md`.

Never edit `task.json`, `epic.json`, or `project.json` directly; use the `agboard` CLI for every change to a card, an epic, or a project. Never delete a card folder or an epic folder: ask a person to delete a card or an epic with the CLI. Do not put a machine-specific absolute path into a shared file.

## Set the project name in the template

Both templates contain the placeholder `PROJECT_NAME` inside single quotes:

```text
agboard --project 'PROJECT_NAME' hook --agent claude
```

Replace the placeholder with your project's exact name. Keep the single quotes; they make the shell pass the name as one fixed word. When the name contains characters with a special meaning, escape them as follows, then paste the result between the single quotes:

- Replace each single quote `'` in the name with `'\''`.
- The command is stored in a JSON string, so write each backslash as `\\` and each double quote as `\"` there.

For the name `Alice's "plan"` the JSON value is:

```text
"command": "agboard --project 'Alice'\\''s \"plan\"' hook --agent claude"
```

Do not build the command from card text, tool input, or other variable data, and do not use shell substitutions (`$(...)`, backticks, `$VAR`) in it. The commands are fixed.

Keep your own settings. Review the template and merge its hook entries into your project's existing configuration; do not replace a settings file that already contains other hooks. Nothing here writes to your user-level or global agent settings. If `agboard` is not on the agent's `PATH`, fix your `PATH`; do not copy a machine-specific absolute path into a shared file.

## Claude Code

Merge `integrations/claude-code/settings.json` into the project's `.claude/settings.json`. It registers the fixed command for:

- `SessionStart` (startup, resume, clear, compact): the first snapshot and the snapshot after compaction.
- `PostToolUse`: a fresh snapshot after each tool.
- `PostToolUseFailure`: a fresh snapshot after a failed tool.

Inspect `/hooks` and confirm the command shows your project name before trusting it. The generic `agent-board` skill does not register hooks itself; name the project each time you use it.

## Codex CLI and Codex App

1. Merge `integrations/codex/hooks.json` into the project's `.codex/hooks.json`; preserve existing hooks.
2. Start Codex in the project and review/trust the hook definitions in `/hooks`.
3. The templates set `additionalContextLimit` to `0` so that the 256 KiB check done by `agboard` is the only limit. SessionStart refreshes the snapshot after startup, resume, clear, or compact; PostToolUse refreshes it after tools.

## After renaming a project

A rename keeps the project's ID, but the hook commands still contain the old name. Update the name in every hook command (and in your agent's instructions) after you rename a project. Until you do, the hook reports `project_not_found`. A project created later with the old name is a different project with different cards, so check the `project.id` in the payload when in doubt.

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
