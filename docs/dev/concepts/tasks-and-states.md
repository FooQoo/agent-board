# Tasks and states

What a project and a task are, which lane and run-state combinations are valid, and how epics, drafts, and archiving fit in. For every field, see [Shared files](../reference/files.md).

## Projects

A project is a unit of work with a name and an immutable **ProjectId**, a 32-character lowercase hexadecimal string generated at creation. Each project owns exactly one board; there is no cross-project board and no moving or copying tasks between projects.

- A name is 1 to 50 Unicode scalar values after trimming, on one line, and unique by exact, case-sensitive match. Project lists are sorted by name.
- Rename and `init` keep the ProjectId. A deleted ProjectId is never reused, so a project re-created with the same name is a different project.
- Task IDs, lane positions, and EPIC-IDs are scoped to a project. The target project is never inferred from omission, the working folder, or the web selection.
- `nextTaskId` starts at 1 and only increases, even across deletion and `init`. A number reserved by a failed creation stays unused.
- `init` keeps the ID, name, and `nextTaskId`, and empties the project's tasks and epics. Deleting a project removes its whole folder and touches no other project.

Change detection uses three values. `version` is computed from one project's source files and has no order. `catalogVersion` does the same for the project list. A `cursor` (`f1:<ProjectId>:<version>`) is what `wait` uses; it follows the same ProjectId across renames and never transfers to another project.

## Lanes and run states

A task's lane says where the work is; its run state says what the agent is doing about it. Not every combination is valid:

| Assignee | Lane | Valid run states |
| --- | --- | --- |
| ai | todo | idle, pending |
| ai | doing | idle, running, pending |
| ai | done | idle only |
| human | any | idle only |

- **Running** is self-reported, not liveness monitoring. It is never reset automatically, and agents do not change it just because a session started or paused.
- **Pending** means the agent is waiting for a person's decision; it may continue other tasks meanwhile.
- Invalid combinations are never saved. A draft task is Idle or Pending in any lane.

How operations move a task between states:

- **Create** puts the task in Todo, Idle, at the end of the lane, and records a creation entry. Without a body, the product writes an empty `acceptance` and an empty body; a supplied body must pass frontmatter validation.
- **Lane move** requires `actor`; `reason` is optional. The task goes to the end of the target lane. A real move resets the run state to Idle, withdraws any open request (a withdrawal is not an answer), appends history, and updates `taskStatusChangedAt`. Moving to the same lane changes nothing.
- **Run state change** requires `actor` and keeps the lane. AI Todo allows Idle↔Pending; AI Doing allows changes among Idle, Running, and Pending. Re-reporting the same state is not a change.
- **Edit** changes only the title, body, and acceptance conditions; the assignee never changes. CLI `--desc`/`--desc-file` take the whole file but keep the history of the latest stored `TASK.md`. `epic edit --plan-file` replaces the whole `PLAN.md`. The web UI sends `body` and `acceptance`, applied to the latest file under the lock.
- **Epic membership** sets or clears `epicId`; only real changes append history. People can change it on draft and archived tasks.
- **Delete** removes the task folder. The web UI deletes only archived tasks; the CLI asks for terminal confirmation.

Ordinary updates are last-write-wins: there is no content check or edit lock. Only answer matching, AI writes to drafts, writes to archived tasks, and bulk-archive targets are validated against the latest `task.json` under the write lock.

## Epics and priority

An epic is a plan (`PLAN.md`) that groups tasks. A task belongs to at most one epic.

| Field | Rule |
| --- | --- |
| `id` | EPIC-ID: 1 to 64 characters matching `[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*`. Lowercase input is uppercased. Immutable. |
| `name` | 1 to 100 characters after trimming, one line. |
| `color` | `#RRGGBB`, uppercased. Random at creation when omitted. |
| `isDraft` | Marks a plan in preparation; member tasks are not affected. |
| `plan`, `body` | The whole `PLAN.md` (0 to 50,000 characters) and the body without frontmatter. |
| `priority`, `priorityError` | Member task IDs in work order, and whether reading them failed. |

- Tasks store only `epicId`; the label color and name are resolved when read.
- An epic referenced by any task, archived ones included, cannot be deleted (`epic_in_use`).
- Epics have no managed acceptance conditions. Reference conditions are ordinary Markdown in the body; the API rejects `acceptance` input for epics.
- `priority` is a list of task IDs in the `PLAN.md` frontmatter, for example `priority: [24, 26, 25]`. Duplicates or invalid types are save errors. IDs that are no longer members are hidden and dropped on the next save; unlisted members follow in creation order. Changing priority does not count as editing a Done task. Lane positions never carry priority.

## Drafts

A draft is a task a person is still writing.

- People toggle `isDraft` in the web UI. Only Idle or Pending tasks can become drafts; Running is refused. A real change appends history but not `updatedAt`.
- CLI `edit`, `mv`, `state`, and `history add` check `isDraft` under the write lock and fail with `task_is_draft`. Reads, `add`, and people's web operations are not affected. Drafts never expire.
- Web editing accepts only draft tasks. With `finalize`, the body, title, `isDraft=false`, and a history entry are committed as one pair.
- The product cannot stop direct edits of a draft's `TASK.md`; the README and the agent skill tell agents not to.

## Archive

- Archiving keeps the lane, `isDraft`, `epicId`, and position; resets the run state to Idle; withdraws the request; and updates `updatedAt`. The lane and `taskStatusChangedAt` do not change. Web archive and restore record the fixed reasons `Archived by user.` and `Restored by user.`
- Restoring places the task at the end of its original lane.
- Normal snapshots, `ls`, and the hook return unarchived tasks only; `show ID` also shows archived ones. Writes to archived tasks fail with `task_archived`, but their images and evidence remain readable. The archive list is sorted by `archivedAt`, newest first.

## Ordering and time

- On the desktop board and in the CLI, Todo and Doing sort by ascending position and Done by descending position. The mobile Done list sorts by `taskStatusChangedAt`, newest first. Completion order is never inferred from history. API `tasks` come in ID order; the UI sorts them for display. Epics sort by EPIC-ID.
- Stored and JSON times are UTC strings in exactly `YYYY-MM-DDTHH:MM:SSZ`; offsets (even `+00:00`) and fractional seconds are rejected. The CLI displays local time of the machine, the UI that of the browser, as `MM/DD HH:mm`.
