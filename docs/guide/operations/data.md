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
  serve.log              output of a server started in the background
  autostart.lock         keeps commands from starting two servers
  autostart.paused       left by agboard stop; the hook does not start a server
  .internal/
    preferences.json     language and color theme (written by the app)
  shared/
    workspace.json
    projects/<project-id>/
      README.md
      project.json
      docs/
        README.md
      tasks/<task-id>/
        task.json
        TASK.md
        assets/
      epics/<EPIC-ID>/
        epic.json
        EPIC.md
        assets/
      qa/Q-<n>/
        QA.md
        attachments/
```

The files are plain Markdown and JSON. What each file must contain is described in [Markdown file format](../reference/file-format). A file whose `formatVersion` is not 1 is unsupported: the application reports it and leaves the file unchanged. It never migrates, falls back to, deletes, or resets old data.

The `.internal/` folder holds the app's own settings. `preferences.json` keeps the language and color theme you chose in **Settings**, and it applies to every browser on this PC and to remote access. The app writes this file, so do not edit it by hand. It is outside `shared/`, so it is not part of a project's files.

Each project's `qa/` folder holds the messages: the questions agents asked, with the answers given, and the requests you sent to agents. Each message is one folder such as `qa/Q-12/`, with its text and status in `QA.md` and any images in `attachments/`. Questions and requests share one numbering, so an ID such as `Q-12` is either a question or a request. A task refers to questions from the `questions` list in its `TASK.md`. Read them with `agboard message ls` and `agboard message show`; do not edit `QA.md` by hand. See [Decisions](../delegate/decisions).

Projects that were saved by an earlier build are converted once, the first time the project is read or written. Questions that were still unanswered and not withdrawn keep their numbers; answered and withdrawn ones are dropped. Unanswered start approvals are not carried over: the AI tasks that waited for one become AI drafts, which you start with `agboard start`. A folder that cannot be read is moved to `.internal/legacy-qa/`.

Each project's `docs/` folder holds your own Markdown documents, which you read and edit from **Docs** in the board header. Agent Board creates the folder with a short `README.md`, but it does not treat the files as board data: changing them never changes the board. See [Project docs](../watch/docs).

## Projects and folders

Most commands name the project with `--project NAME`. A project keeps its ID when you rename it, so folder registrations, tasks, and history follow the new name.

```sh
agboard project create "My project"
agboard project ls --json
agboard --project "My project" project rename "Website launch"
```

Update the name in commands that pass `--project` explicitly; folder-based progress and hooks keep resolving the same project. `project rm` deletes the named project, its tasks, and its `docs/` folder, asks for a person's confirmation, and is unavailable to agents.

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

`agboard setup` prepares the data folder for Codex and Claude Code, and installs the Agent Board plugin (see [Working with agents](../delegate/agents#set-up-your-agents)). It needs no project. For the data folder it does the following:

- creates the data folder and its `shared/` folder;
- adds the data folder to `sandbox_workspace_write.writable_roots` in Codex's `config.toml`, in `$CODEX_HOME` or `~/.codex`;
- writes `rules/agboard.rules` in the same Codex folder, so that Codex runs `agboard` without asking, unless the file exists already;
- adds the data folder to `permissions.additionalDirectories` in Claude Code's `settings.json`, in `$CLAUDE_CONFIG_DIR` or `~/.claude`.

```sh
agboard setup --agent all --dry-run
agboard setup
```

`--dry-run` prints the planned changes and changes nothing. `--json` prints the same result as machine-readable JSON. A dry run prints output like this (`<home>` stands for your home directory, and `X.Y.Z` for the version):

```text
Dry run: nothing was installed, created, or changed.
Data directory: <home>/.agent-board
Shared folder: <home>/.agent-board/shared
Codex: planned
  plugin: install version X.Y.Z from https://github.com/FooQoo/agent-board.git at vX.Y.Z
  planned <home>/.codex/config.toml
    - add "<home>/.agent-board" to sandbox_workspace_write.writable_roots
  planned <home>/.codex/rules/agboard.rules
    - allow the agboard command (prefix_rule)
Claude Code: planned
  plugin: install version X.Y.Z from https://github.com/FooQoo/agent-board.git at vX.Y.Z
  planned <home>/.claude/settings.json
    - add "<home>/.agent-board" to permissions.additionalDirectories
```

Setup keeps every existing setting and changes only the arrays above. Before it changes an existing settings file, it writes a backup next to that file, named `<file>.agboard-backup…`. The backup holds your original settings, so keep it out of shared folders. Running setup again changes nothing, and each file is reported as `unchanged`. If a settings file cannot be read or has the wrong shape, setup writes nothing at all and names the file.

Setup changes Codex's `config.toml` only when `sandbox_mode` is `"workspace-write"` and no permission profile (`default_permissions`, `permissions`, `profile`, or `profiles`) is set. Otherwise it leaves the file as it is and shows the manual step; the plugin is still installed. Setup never changes `sandbox_mode` itself. With `sandbox_mode = "danger-full-access"`, Codex already reaches every folder, so setup writes neither the permission nor the rule file.

Setup is a step that you run; do not ask an agent to run it during normal work. Project or managed settings can still limit access to the folder, so confirm it in a new session.

## Back up and restore

Stop the server with `agboard stop`, and stop agents and editors writing to the files, before backing up or restoring. Copy the whole `shared/` folder to preserve all projects and the workspace format. For one project, copy its entire folder, using the `folder` value from `workspace --json`. Restore the copy to the same location before restarting the server and agents.

Copying `shared/` does not include `.internal/`, so a project backup does not carry the language and color theme. To keep them too, copy `preferences.json` as well.

## Next

- [Working with agents](../delegate/agents): set up an agent to use this folder.
- [Troubleshooting](./troubleshooting): a project or folder that cannot be found.
