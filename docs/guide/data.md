---
title: Data and backups
---

# Data and backups

## Where the data lives

The default data folder is `.agent-board/` directly in your home directory:

| OS | Default folder |
| --- | --- |
| macOS | `~/.agent-board/` |
| Windows | `%USERPROFILE%\.agent-board\` |

Set `AGBOARD_HOME` to use another data folder. An empty value counts as unset. The CLI, server, hooks, and `agboard setup` must use the same folder to share a board.

```text
.agent-board/
  bindings.json          folder registrations (machine-specific)
  serve.json             how the CLI finds a running agboard serve
  shared/
    workspace.json
    projects/<project-id>/
      README.md
      project.json
      tasks/<card-id>/
        task.json
        TASK.md
        assets/
        evidence/
      epics/<EPIC-ID>/
        epic.json
        PLAN.md
        assets/
```

`task.json` contains card metadata such as its current lane and owner and uses format version 3. The card's body, acceptance conditions, and operation history are stored in `TASK.md`; the UI reads its History tab from that Markdown history. UI and CLI status changes append to the same history. Every history entry in the top-level `history` frontmatter has exactly `at` (timestamp) and `reason` (content); work progress and card operations share this shape in files, the API, and the CLI. Plans, verification results, and evidence references belong in the body; chronological history does not. Epic plans are stored in `PLAN.md`, with optional priority metadata for task order; reference conditions belong in the Markdown body and epics have no history.

Task format versions 1 and 2 are unsupported: the application reports them and leaves their files unchanged. It does not migrate, fall back to, delete, or reset old task data. Other shared JSON files remain format version 1.

## Set up the shared folder

`agboard setup` prepares the data folder for Codex and Claude Code. It needs no project, and it does the following:

- creates the data folder and its `shared/` folder;
- adds the data folder to `sandbox_workspace_write.writable_roots` in Codex's `config.toml`, in `$CODEX_HOME` or `~/.codex`;
- adds the data folder to `permissions.additionalDirectories` in Claude Code's `settings.json`, in `$CLAUDE_CONFIG_DIR` or `~/.claude`.

```sh
agboard setup --dry-run
agboard setup
```

`--agent codex|claude|all` chooses which settings to update; the default is `all`. `--dry-run` prints the planned changes and changes nothing. `--json` prints the same result as machine-readable JSON. A dry run prints output like this (`<home>` stands for your home directory):

```text
Dry run: no files, folders, or backups were created.
Data directory: <home>/.agent-board
Shared folder: <home>/.agent-board/shared
Codex: planned <home>/.codex/config.toml
  - add "<home>/.agent-board" to sandbox_workspace_write.writable_roots
Claude Code: planned <home>/.claude/settings.json
  - add "<home>/.agent-board" to permissions.additionalDirectories
```

Setup keeps every existing setting and changes only the array above. Before it changes an existing settings file, it writes a backup next to that file, named `<file>.agboard-backup-<id>`. Running setup again changes nothing, and each file is reported as `unchanged`.

Setup refuses to write Codex settings unless `sandbox_mode` is `"workspace-write"`. Only that mode is supported, and permission profiles (`default_permissions`, `permissions`, `profile`, or `profiles`) are refused as well. Setup never changes `sandbox_mode` itself. If it refuses, set `sandbox_mode = "workspace-write"` in `config.toml` yourself, then run setup again. A refusal writes nothing, and with the default `--agent all`, a refused Codex target also blocks the Claude Code change. If you do not use Codex, run `agboard setup --agent claude`.

Setup does not install the hooks or the `agent-board` skill. Those remain separate manual steps (see [Working with agents](./agents)). Setup is a one-time step that you run; do not ask an agent to run it during normal work. Project or managed settings can still limit access to the folder, so confirm it in a new session.

## Adopting an existing board

Earlier versions stored the board in the OS application data folder: `~/Library/Application Support/agboard/` on macOS and `%APPDATA%\agboard\` on Windows. Current versions use `~/.agent-board/` by default. Nothing is migrated or deleted from the old folder. Its contents stay where they are, and the default folder does not read them.

To adopt the shared folder:

1. Reinstall `agboard` from the updated repository (see [Getting started](./getting-started)) and restart `agboard serve`. Neither is updated automatically.
2. Run `agboard setup` yourself, or `agboard setup --agent claude` if you do not use Codex.
3. Start new Codex and Claude Code sessions so that they load the change.

To keep using the board in the old folder, set `AGBOARD_HOME` to that folder. Setup then adds that folder to the agent settings instead of the default one.

## Back up and restore

Stop `agboard serve`, agents, and editors writing to the files before backing up or restoring. Copy the whole `shared/` folder to preserve all projects and the workspace format. For one project, copy its entire folder, using the `folder` value from `workspace --json`. Restore the copy to the same location before restarting the server and agents.

## Folder registrations

Folder registrations live separately in `bindings.json` in the data area and contain machine-specific paths. Keep that file for a same-machine backup if needed; use `project bind` to register the correct folders on another machine. Do not commit it or place it inside the shared project files.
