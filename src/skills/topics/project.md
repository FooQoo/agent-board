# Resolve the project and read the progress table

Use the nearest registered project folder that contains the current working folder. Start with `agboard progress --json`.

A project is identified by both `project.id` and `project.name` in the progress table. If the current folder is not registered, or its nearest registered project is missing, stop and report the error; do not guess from another project or fall back to a parent binding. An explicit `--project "<name>"` overrides folder resolution. Use the selected name explicitly for write commands. A rename keeps the ID, and the current folder binding follows that project.

`agboard project ls --json` is for inspecting registered projects; it does not select a project for work.

If `agboard` is not on `PATH`, use an executable supplied by the user or the project runtime. Do not install tools, create a project, or initialize a substitute board on your own.

If the error is `folder_unbound`, report it and show the user these steps to run themselves in a terminal: `agboard project create "<name>"` (or `agboard project bind "<name>"` for an existing project), and `agboard setup` if Agent Board is not set up yet for every agent they use. `agboard setup` installs this Skill and the Hook and asks the user to choose and confirm in a terminal; never run it, create or bind a project, or pick another project on the user's behalf, and keep working on tasks that do not need the board.

Use a CLI that supports `history add`. If the command is unavailable, report the version mismatch; do not fall back to a body execution log or edit `task.json`. Do not replace the installed executable automatically.

## Read only what is needed

Before choosing, starting, or resuming work, read the progress table. It groups active tasks under epics and lists unassigned work. Done, archived, and Pending tasks are omitted. A `requests` array lists the open requests a person sent you and an `answers` array lists the answers to your questions that you have not taken in (see `agboard skills requests`). A question stays on the board until answered; inspect it with `show` or `snapshot`, never read its absence from progress as expiry. It has IDs, titles, owners, statuses, acceptance counts, and paths, but no bodies, history, or images. Read only the selected epic's `EPIC.md` and task's `TASK.md` before implementation. Use `show <id> --json` when history or a current question/answer is needed. Hooks attach the same table:

- `AGBOARD_PROGRESS` is followed by the progress table for the nearest bound folder or explicit project.
- `AGBOARD_ERROR` (for example `bound_project_missing`) means there is no usable table. Resolve the correct folder or report the problem; do not guess.

After context compaction, read a fresh progress table before any board-dependent change. This skill does not register hooks; never add or edit the user's installed hook command.
