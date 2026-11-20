# The Agent Board plugin

This folder is the Agent Board plugin for Claude Code and Codex. It holds the `agent-board` Skill, the `remote` Skill (the phone address and passcode, `/agent-board:remote` in Claude Code), the `wait` Skill (keeps a session listening on the board, `/agent-board:wait`), and the Hook. Install it with:

```sh
agboard setup
```

For browser operations, CLI examples, and shared-file editing, see the [usage guide](https://fooqoo.github.io/agent-board/guide/), in particular [CLI reference](https://fooqoo.github.io/agent-board/guide/reference/cli) and [Editing and image attachments](https://fooqoo.github.io/agent-board/guide/watch/editing).

Agent Board hooks read the same read-only progress table as `agboard progress --json` after tools run and pass it to the agent as `additionalContext`. The `agent-board` skill (its text is printed by `agboard skills agent-board`) describes how to choose work from that table, read only the needed plan and task files, record work, and verify acceptance conditions.

## Resolve the project from the working folder

The Hook runs a fixed command such as `agboard hook --agent claude`; it contains no project name, session ID, shell variables, or substitutions. The hook reads `cwd` from its JSON input and resolves the nearest registered ancestor folder. If `cwd` is absent, it uses the hook process's current folder. An explicit `--project NAME` overrides folder bindings. A folder with no binding at all produces no output and exit code 0, so a Global Hook does not disturb other folders. A malformed binding, a deleted bound project, or an unreadable `cwd` produces `AGBOARD_ERROR`; the hook never guesses another project.

The `AGBOARD_PROGRESS` payload contains project metadata, versions, paths to each epic `EPIC.md` and task `TASK.md`, and each eligible task's ID, title, owner, status, and acceptance count. It excludes Done, archived, and Pending tasks, and omits bodies, history, and image data. Human-owned and draft tasks remain visible, each with its `draft` owner (`null`, `human`, or `ai`); do not take work assigned to a person or a draft. When a person has sent a request, a `requests` array lists it; accept it with `agboard message accept` and plan it. Read only the plan and task files needed for the selected work. If the complete progress table exceeds 256 KiB or cannot be read, the agent gets `AGBOARD_ERROR` and must not make board-dependent changes. The hook never truncates the table and never blocks or changes the original tool result.

Image attachments follow the same project and task boundaries. Use `agboard --project NAME attachment add <task-id> --file PATH --actor ai|human` to add an image, `agboard --project NAME attachment ls <task-id>` to read metadata, and `agboard --project NAME attachment get <task-id> <attachment-id> --output PATH` to retrieve bytes. Snapshot and wait payloads contain attachment metadata only; progress and hook payloads omit attachments. Image bytes are returned only by `get`. Draft tasks, invalid or oversized image files, and tasks outside the named project are rejected. Retrieval never overwrites an existing output file.

## Install

`agboard setup` installs this plugin with each agent's own plugin command. The repository is the marketplace of both agents, and setup adds it at the tag of the `agboard` version, so the plugin always matches the command. It also lets the agents use the shared folder and, with your consent, trusts the plugin's hooks in Codex. See [Working with agents](https://fooqoo.github.io/agent-board/guide/delegate/agents#set-up-your-agents) for what it asks and changes.

To install the plugin by hand instead, run the same commands, with `X.Y.Z` replaced by the version that `agboard --version` prints:

```sh
# Codex
codex plugin marketplace add https://github.com/FooQoo/agent-board.git --ref vX.Y.Z
codex plugin add agent-board@agent-board

# Claude Code
claude plugin marketplace add https://github.com/FooQoo/agent-board.git#vX.Y.Z
claude plugin install agent-board@agent-board
```

The plugin is installed for your user, so it works in every folder. In a folder with no project, the Hook prints nothing and exits normally. Hooks and the Skill run `agboard` from `PATH`, so they use the installed version. The Skill's instructions are embedded in `agboard`, so they always match it.

| Path | What it is |
| --- | --- |
| `.agents/plugins/marketplace.json` | The Codex marketplace catalog, at the repository root |
| `.claude-plugin/marketplace.json` | The Claude Code marketplace catalog, at the repository root |
| `plugins/agent-board/.codex-plugin/plugin.json` | The Codex plugin manifest |
| `plugins/agent-board/.claude-plugin/plugin.json` | The Claude Code plugin manifest |
| `plugins/agent-board/skills/agent-board/SKILL.md` | A thin entry for the Skill, shared by both agents; the instructions themselves come from `agboard skills agent-board` |
| `plugins/agent-board/skills/remote/` | The Skill that gives the phone address and passcode, shared by both agents |
| `plugins/agent-board/skills/wait/` | The Skill that keeps a session listening on the board, shared by both agents |
| `plugins/agent-board/hooks/codex.json`, `hooks/claude.json` | The Hook of each agent |

## Trust hooks

Codex runs a plugin's hook only after you trust it, and the trust is tied to the hook's content. `agboard setup` and `agboard update` trust the Agent Board hooks for you when you agree on their confirmation screen; other hooks are not touched. If you installed by hand, review and trust the hooks with `/hooks` in Codex. In Claude Code, review them with `/hooks` after you start a new session. Check the project binding from the working folder with `agboard progress --json`.

## Update the plugin

After `brew upgrade fooqoo/tap/agboard`, the plugin updates itself: when a session starts, the Hook compares the plugin's files with the ones this `agboard` ships, and when they differ it reinstalls the plugin from the tag of the `agboard` version in the background. The new plugin applies from the next session. For Codex it also trusts the Agent Board hooks, but only when the installed hook definition is byte-identical to the one `agboard` ships (your consent in `agboard setup` covers Agent Board's own hook); a different definition is never trusted, and then you run `agboard update` yourself (or `agboard update --yes`, which answers the question in advance). `agboard update` also reinstalls and repairs the plugin in either agent. Set `AGBOARD_NO_PLUGIN_AUTO_UPDATE=1` to turn the automatic update off.

## Rules for agents on the shared files

The project folder holds plain files that the CLI and the browser read. Agents may read them at any time. Agents may edit only these, and only as the folder's README allows:

- A task's `TASK.md`, to record its plan and verification results in the body and to set its completion conditions (`done`) in the frontmatter. Operation history is recorded by the CLI; do not write a chronological log in the body. Never edit the `TASK.md` of a draft task: a person's draft (`"draft": "human"`) waits until the user finalizes it, and an AI draft (`"draft": "ai"`) is changed only with `edit` until a person starts it.
- An epic's `EPIC.md`.

Never edit `task.json`, `epic.json`, or `project.json` directly; use the `agboard` CLI for every change to a task, an epic, or a project. Never delete a task folder or an epic folder: ask a person to delete a task or an epic with the CLI. Do not put a machine-specific absolute path into a shared file.

Keep your own settings. The plugin brings its own Hook, so your settings files keep your other hooks. `agboard setup` changes user-level agent settings only to add the data folder and, for Codex, to allow the `agboard` command. If `agboard` is not on the agent's `PATH`, fix your `PATH`; do not copy a machine-specific absolute path into a shared file.

Done tasks are read-only for agents and do not return to progress unless a user reopens them. Pending tasks also stay out of the progress table until answered; their questions are kept on the board. Use `show <id> --json` for a known waiting task or `snapshot --json` to inspect all current questions, then `wait` when no work can proceed. Do not infer that a question expired because it is absent from progress.

## Claude Code

`hooks/claude.json` registers the fixed command for:

- `SessionStart` (startup, resume, clear, compact): the first progress table and the table after compaction.
- `PostToolUse`: a fresh progress table after each tool.
- `PostToolUseFailure`: a fresh progress table after a failed tool.
- `Stop`: blocks a turn once when it ends with a question that is not on the board (see the developer guide).

Inspect `/hooks` and review the fixed command. The `agent-board` Skill does not register hooks itself.

## Codex CLI and Codex App

`hooks/codex.json` registers the fixed command for `SessionStart` (startup, resume, clear, compact) `PostToolUse`, and `Stop`. It sets `additionalContextLimit` to `0` so that the 256 KiB check done by `agboard` is the only limit.

## After renaming a project

A rename keeps the project's ID and its folder bindings. If you explicitly pass `--project`, use the new name. A project created later with the former name is a different project.

## Waiting for a user response

When no work can proceed, read the snapshot of your project and use its `cursor`:

```sh
agboard --project "My project" snapshot --json
agboard --project "My project" wait --after <cursor> --json
```

`wait` resolves the project name once, checks that the cursor belongs to that project, and then follows that same project. Changes to other projects do not end it. If the project is renamed while waiting, it keeps following the same project and returns its latest snapshot. If the project is deleted it fails with `project_not_found`, and it never switches to a project created later with the same name. It listens for a local board-change event from the server of the same data area, which it starts in the background when none runs; it does not poll or update tasks. The Hook also starts that server, without waiting, so automatic Done works while an agent only edits files. After `agboard stop`, the Hook does not start it until a waiting command or `agboard serve` does. Set `AGBOARD_AUTOSTART=0` to turn this off. When it returns, read the full snapshot and history, reconsider the user's reason, then resume or ask a follow-up question.

`wait_timeout`, `board_unavailable`, `local_network_denied`, `cursor_invalid`, and `project_not_found` are errors, not answers.

## Verification status

The repository tests exercise the hook payloads and the wait/SSE round trip with a real local server and temporary data. They do not prove that a particular Claude Code or Codex installation trusted the hook or delivered the entire context to a model. Complete the in-session check for your installed agent after reviewing the hook in `/hooks`. The Codex App cannot be checked automatically; verify it by hand.
