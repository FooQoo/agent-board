---
title: Data and backups
---

# Data and backups

Agent Board keeps everything as plain files in one folder on your machine. This page shows where they are, how projects and folders are registered, how to give agents access to the folder, and how to back it up.

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
      tasks/<task-id>/
        task.json
        TASK.md
        assets/
        evidence/
      epics/<EPIC-ID>/
        epic.json
        PLAN.md
        assets/
```

The files are plain Markdown and JSON. What each file must contain is described in [Markdown file format](../automation/file-format). A file whose `formatVersion` is not 1 is unsupported: the application reports it and leaves the file unchanged. It never migrates, falls back to, deletes, or resets old data.

## Projects and folders

Most commands name the project with `--project NAME`. A project keeps its ID when you rename it, so folder registrations, tasks, and history follow the new name.

```sh
agboard project create "My project"
agboard project ls --json
agboard --project "My project" project rename "Website launch"
```

Update the name in commands that pass `--project` explicitly; folder-based progress and hooks keep resolving the same project. `project rm` deletes the named project and its tasks, asks for a person's confirmation, and is unavailable to agents.

### Register a folder

`agboard progress` and hooks use the nearest registered project folder when you do not pass `--project`. `project create` also registers the current working folder. Use `--folder` for another existing folder, or `project bind` for an existing project:

```sh
agboard project create "Website launch" --folder ./website
agboard project bind "My project"
agboard project bind "My project" --folder ./docs
```

A folder belongs to one project; several folders can belong to the same project. Commands in subfolders use the nearest registered ancestor. A missing or broken registration returns an error instead of guessing another project; other commands never infer a project from the browser or from another agent.

Registrations live separately in `bindings.json` in the data folder and contain machine-specific paths. Keep that file for a same-machine backup if you want to; use `project bind` to register the right folders on another machine. Do not commit it or place it inside the shared project files.

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

Setup does not install the hooks or the `agent-board` skill. Those remain separate manual steps (see [Working with agents](../automation/agents)). Setup is a one-time step that you run; do not ask an agent to run it during normal work. Project or managed settings can still limit access to the folder, so confirm it in a new session.

## Back up and restore

Stop `agboard serve`, agents, and editors writing to the files before backing up or restoring. Copy the whole `shared/` folder to preserve all projects and the workspace format. For one project, copy its entire folder, using the `folder` value from `workspace --json`. Restore the copy to the same location before restarting the server and agents.

## Next

- [Working with agents](../automation/agents): connect an agent to this folder.
- [Troubleshooting](./troubleshooting): a project or folder that cannot be found.
