---
title: Data and backups
---

# Data and backups

## Where the data lives

The default data folder is `agboard/` under the OS application data folder:

| OS | Default folder |
| --- | --- |
| macOS | `~/Library/Application Support/agboard/` |
| Windows | `%APPDATA%\agboard\` |

Set `AGBOARD_HOME` to use another data folder. The CLI, server, and hooks must use the same folder to share a board.

```text
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

## Back up and restore

Stop `agboard serve`, agents, and editors writing to the files before backing up or restoring. Copy the whole `shared/` folder to preserve all projects and the workspace format. For one project, copy its entire folder, using the `folder` value from `workspace --json`. Restore the copy to the same location before restarting the server and agents.

## Folder registrations

Folder registrations live separately in `bindings.json` in the data area and contain machine-specific paths. Keep that file for a same-machine backup if needed; use `project bind` to register the correct folders on another machine. Do not commit it or place it inside the shared project files.
