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
  .internal/
    preferences.json     language and color theme (written by the app)
  shared/
    workspace.json
    projects/<project-id>/
      README.md
      project.json
      tasks/<task-id>/
        task.json
        TASK.md
        assets/
      epics/<EPIC-ID>/
        epic.json
        EPIC.md
        assets/
```

The files are plain Markdown and JSON. What each file must contain is described in [Markdown file format](../automation/file-format). A file whose `formatVersion` is not 1 is unsupported: the application reports it and leaves the file unchanged. It never migrates, falls back to, deletes, or resets old data.

The `.internal/` folder holds the app's own settings. `preferences.json` keeps the language and color theme you chose in **Settings**, and it applies to every browser on this PC and to the mobile monitor. The app writes this file, so do not edit it by hand. It is outside `shared/`, so it is not part of a project's files.

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

## Upgrading from PLAN.md

Earlier versions stored each epic's details in `PLAN.md`. This version stores them in `EPIC.md`. The change is automatic and one-way: earlier versions cannot read `EPIC.md`.

Before the first run, stop `agboard serve`, agents, and editors, and back up the whole `shared/` folder (see the next section).

The first time a project is read, Agent Board renames each epic's `PLAN.md` to `EPIC.md` in the same folder. The file's bytes do not change, so the frontmatter, `priority`, body, images, attachments, and task membership stay as they were. Each rename is made under the project's write lock, so an interrupted run is finished by the next read. An epic that already has `EPIC.md` is not changed.

Two situations need your attention:

- **Both files exist.** Agent Board changes neither file. Every read of that project fails with `file_invalid`, and the message names the epic and both paths. Compare the two files, keep the content you want in `EPIC.md`, and delete the other file by hand.
- **Neither file exists.** The epic is still listed, but its details are empty, and `snapshot` reports the missing file in `problems`. Restore the file from your backup.

To return to an earlier version, restore the backup you made before the upgrade. Earlier versions do not see details written to `EPIC.md` after the upgrade. A backup that still contains `PLAN.md` is migrated again the first time this version reads it.

Scripts and integrations also use new names:

| Earlier | Now |
| --- | --- |
| `epic edit --plan` | `epic edit --document` |
| `epic edit --plan-file` | `epic edit --document-file` |
| `plan` in epic JSON | `document` |
| `planPath` in hook, progress, and wait output | `documentPath` |
| `PLAN.md` | `EPIC.md` |

The earlier names are not accepted or produced. Update hook scripts, agent instructions, and any script that reads these fields.

## Back up and restore

Stop `agboard serve`, agents, and editors writing to the files before backing up or restoring. Copy the whole `shared/` folder to preserve all projects and the workspace format. For one project, copy its entire folder, using the `folder` value from `workspace --json`. Restore the copy to the same location before restarting the server and agents.

Copying `shared/` does not include `.internal/`, so a project backup does not carry the language and color theme. To keep them too, copy `preferences.json` as well.

## Next

- [Working with agents](../automation/agents): connect an agent to this folder.
- [Troubleshooting](./troubleshooting): a project or folder that cannot be found.
