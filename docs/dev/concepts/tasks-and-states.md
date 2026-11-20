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
- **Pending** means the task refers to a project question that has no reply yet, or to a message file that cannot be read; the agent may continue other tasks meanwhile. Pending is never stored: `task.json` holds Idle or Running, and readers derive Pending from the task's `questions` (see [Messages](./history-and-decisions.md#messages)).
- Invalid combinations are never saved. A draft task is Idle or Pending in any lane.

How operations move a task between states:

- **Create** puts the task in Todo, Idle, at the end of the lane, and records a creation entry. Without a body, the product writes an empty `acceptance` and an empty body; a supplied body must pass frontmatter validation.
- **Lane move** requires `actor`; `reason` is optional. The task goes to the end of the target lane. A real move resets the stored run state to Idle, appends history, and updates `taskStatusChangedAt`. Moving to the same lane changes nothing.
- **Run state change** requires `actor` and keeps the lane. `state` accepts Idle and Running; only AI Doing can be Running. An AI change to Running is refused with `questions_unanswered` while the task waits for an answer. Questions are asked with `message ask`, which also returns a Running task to Idle. Moving the lane or archiving keeps the task's questions and references. Re-reporting the same state is not a change.
- **Edit** changes only the title, body, and acceptance conditions; the assignee never changes. CLI `--desc`/`--desc-file` take the whole file but keep the history and the `questions` refs of the latest stored `TASK.md`; those two keys in the input are ignored, so a task that refers to an open question stays Pending. `epic edit --document-file` replaces the whole `EPIC.md` text. The web UI sends `body` and `acceptance`, applied to the latest file under the lock.
- **Epic membership** sets or clears `epicId`; only real changes append history. People can change it on draft and archived tasks.
- **Delete** removes the task folder. The web UI deletes only archived tasks; the CLI asks for terminal confirmation.

Ordinary updates are last-write-wins: there is no content check or edit lock. Only answers, AI writes to drafts, writes to archived tasks, and bulk-archive targets are validated against the latest `task.json` under the write lock.

## Epics and waves

An epic is a management unit that groups tasks and sets their work order. Its details (`EPIC.md`) are Markdown notes on its goal, scope, and decisions. A task belongs to at most one epic. The task's `epicId` is the only record of membership; the epic keeps no list of its tasks.

| Field | Rule |
| --- | --- |
| `id` | EPIC-ID: 1 to 64 characters matching `[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*`. Lowercase input is uppercased. Immutable. |
| `name` | 1 to 100 characters after trimming, one line. |
| `color` | `#RRGGBB`, uppercased. Random at creation when omitted. |
| `draft` | `null`, `"human"`, or `"ai"`, as for a task. A person's draft epic (`human`) is refused by CLI `epic edit` and `--waves` with `epic_is_draft`; an AI draft epic is edited by agents as usual. Member tasks and `epic attachment` are not affected. |
| `document`, `body` | The whole `EPIC.md` text, frontmatter included (0 to 100,000 characters), and the body without frontmatter. |
| `waves`, `wavesError` | The member tasks in work order as waves (a list of task ID lists), and whether reading the stored order failed. |

- Tasks store only `epicId`; the label color and name are resolved when read.
- An epic referenced by any task, archived ones included, cannot be deleted (`epic_in_use`). The web UI deletes an epic from the epic editor through `DELETE .../epics/{epicId}`; the CLI uses `epic rm`.
- A new project starts with the default epics `BUG` and `ENHANCEMENT`. They are ordinary epics: they can be edited and deleted. `defaultEpicsSeeded` in `project.json` is set once the project has been offered them, so a deleted default epic is not created again. `serve` offers them once to a project that does not have the flag yet.
- Epics have no managed acceptance conditions. Reference conditions are ordinary Markdown in the body; the API rejects `acceptance` input for epics.
- `waves` is a YAML list in the `EPIC.md` frontmatter in which every item is one wave: a task ID (`24`) or task IDs joined by commas (`26,25`; spaces after commas and quotes are accepted). Nested lists are not accepted. Duplicates across waves, non-positive IDs, empty items, and invalid types are errors. Writing drops empty waves. IDs that are no longer members are hidden and dropped on the next save, and a wave that becomes empty is dropped; unlisted members follow in creation order. Changing the waves does not count as editing a Done task. Lane positions never carry the order.
- A wave starts only when every task of the earlier waves is Done. `nextTasks` holds back a Todo task while any non-archived task of an earlier wave of its epic is not Done; archived tasks are ignored, tasks that no wave lists are never held back, and an unreadable order gates nothing. Stalled Doing work is still offered as `resume`.

## Drafts

A draft is a task or epic that is not put to work yet. `draft` says who still owns it: `null` (a normal task), `"human"` (a person is writing it in the browser), or `"ai"` (an agent proposed it, and it is started once its questions are answered). The stored field is described in [Shared files](../reference/files.md). Drafts never expire, and `wait` and automatic Done skip every draft.

- A task or epic an agent creates (CLI `add` and `epic add`, whoever it is assigned to) is an AI draft. What a person creates is `null`, or `human` when the browser creates it as a draft.
- The preview enters a person's draft at its first real change: `PUT /tasks/{id}/draft` with `draft: "human"` for a task, and `PATCH /epics/{id}` with `draft: "human"` for an epic. Only Idle or Pending tasks can become drafts; Running is refused with `invalid_state_for_draft`. A real change appends history but not `updatedAt`. Entering or leaving an epic draft does not change `updatedAt` either. A person who edits an AI proposal enters `human` the same way and saves with `draft: "ai"`, which returns it to the proposal.
- A `human` draft: CLI `edit`, `mv`, `state`, and `history add` check `draft` under the write lock and fail with `task_is_draft`; CLI `epic edit` and `epic edit --waves` fail with `epic_is_draft`. An `ai` draft: `edit`, `history add`, and `epic edit` work, while `mv` and `state` fail with `task_is_draft`. Reads, `add`, `epic attachment`, and membership changes are not affected. The web `PATCH` on an epic does not refuse a draft.
- Web editing accepts only draft tasks. With `finalize`, the body, title, `draft: null`, and a history entry are committed as one pair. Discard sends `discard: true` with `draft: null` instead, and the history records `Discarded draft changes.` An epic has no history, so its discard is only `draft: null` on `PATCH /epics/{id}`. An AI draft is never finalized this way: it fails with `ai_draft_needs_start`.
- **Start.** The agent that wrote the plan starts its own AI drafts once its questions are answered and the plan is written up; a person can start them too. `agboard start <id> --actor ai` clears one task's AI draft. `agboard epic start <EPIC-ID> --actor ai` clears the epic and every non-archived task of it that is an AI draft in one save (a batch that rolls back as a whole). There is no web route and no button for starting: the web UI only shows the draft badge. Each cleared task records `The agent wrote the plan up and started the task.` for `--actor ai` or `A person started the task.` for `--actor human`; an epic keeps no history. A person's own (`human`) drafts are not cleared, and a task that is not a draft changes nothing. One function, `ensure_startable` in `src/file_store/ops/start.rs`, is the place for the rules that refuse a start. It refuses while a question without a reply names the task being started (task start), or any AI-draft task the epic start would clear (epic start), with `start_blocked_by_questions` over the CLI and the API; the answer may change the plan, so the question is answered first and the plan is started afterwards. A question about a task outside the epic, or one that is answered or withdrawn, does not block.
- The product cannot stop direct edits of a draft's `TASK.md`; the README and the agent skill tell agents not to.

## Archive

- Archiving keeps the lane, `draft`, `epicId`, and position; resets the stored run state to Idle; keeps the task's question references; and updates `updatedAt`. The lane and `taskStatusChangedAt` do not change. Web archive and restore record the fixed reasons `Archived by user.` and `Restored by user.`
- Restoring places the task at the end of the lane it was archived from, with the run state Idle. Archiving always stores Idle, so a restored task has the run state it had at archive time, and the lane and Idle are always a valid pair under the work model; no fallback is needed. The phone's archive list restores through the same `POST …/tasks/{id}/restore` as the PC.
- Normal snapshots, `ls`, and the hook return unarchived tasks only; `show ID` also shows archived ones. Writes to archived tasks fail with `task_archived`, but their images remain readable. The archive list is sorted by `archivedAt`, newest first.

## Ordering and time

- On the desktop board and in the CLI, Todo and Doing sort by ascending position and Done by descending position. The mobile Done list sorts by `taskStatusChangedAt`, newest first. Completion order is never inferred from history. API `tasks` come in ID order; the UI sorts them for display. Epics sort by EPIC-ID.
- Stored and JSON times are UTC strings in exactly `YYYY-MM-DDTHH:MM:SSZ`; offsets (even `+00:00`) and fractional seconds are rejected. The CLI displays local time of the machine, the UI that of the browser, as `MM/DD HH:mm`.
