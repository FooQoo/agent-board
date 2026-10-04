# Claude Code and Codex integration

Agent Board hooks read a complete, read-only board snapshot after tools run. They pass that snapshot to the agent as `additionalContext`. The `skan-board` skill describes how to choose work, add reasons, request a decision, wait for changes, and resume from the user's answer.

Install `agboard` and initialize the new board before enabling hooks:

```sh
agboard init --name agent-board
```

Keep your own settings. Review the template and merge its hook entries into your project's existing configuration; do not replace a settings file that already contains other hooks. If `agboard` is not on the agent's `PATH`, replace the command with the absolute path you verified locally.

## Claude Code

1. Install the `skan-board` skill in a project skill directory Claude Code reads, preserving the YAML frontmatter hooks. The canonical skill is maintained in the personal Wiki repository at `.agents/skills/skan-board/SKILL.md`.
2. Merge `integrations/claude-code/settings.json`'s `SessionStart` entry into the project's `.claude/settings.json`. It refreshes the snapshot at startup, resume, clear, and compact.
3. Invoke `/skan-board` once per session. Claude Code registers the skill's `PostToolUse` and `PostToolUseFailure` hooks for the rest of that session. Inspect `/hooks` and confirm the fixed `agboard hook --agent claude` command before trusting it.

## Codex CLI and Codex App

1. Merge `integrations/codex/hooks.json` into the project's `.codex/hooks.json`; preserve existing hooks.
2. Start Codex in the project and review/trust the hook definitions in `/hooks`.
3. Use the `skan-board` skill at the start of the task. SessionStart refreshes the snapshot after startup, resume, clear, or compact; PostToolUse refreshes it after tools.

Both templates invoke a fixed command. Card content and tool input are never interpolated into shell commands. The hook does not change the board. It caps the hook input and complete context at 64 KiB and returns `AGBOARD_ERROR` instead of presenting a truncated snapshot as complete.

## Waiting for a user response

When no work can proceed, read the latest snapshot revision and run:

```sh
agboard wait --after <revision>
```

The command listens for a local board-change event; it does not poll or update cards. When it returns, read the full snapshot and history, reconsider the user's reason, then resume or ask a follow-up question. `wait_timeout` and `board_unavailable` are errors, not answers.

## Verification status

The repository tests exercise hook payload construction and the wait/SSE round trip with a real local server and temporary data. They do not prove that a particular Claude Code or Codex installation trusted the hook or delivered the entire context to a model. Complete the in-session check for your installed agent after reviewing the hook in `/hooks`.
