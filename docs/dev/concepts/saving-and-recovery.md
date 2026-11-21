# Saving and recovery

Several agents, the CLI, the web server, and text editors may touch the same files at once. This page explains how Agent Board keeps the files consistent and what happens when something goes wrong. If you are debugging a failure, also read [Troubleshooting](../troubleshooting.md).

## Locks

| Lock | Scope | Used for |
| --- | --- | --- |
| `.internal/write.lock` | One project | Every CLI and web write: `task.json`, `epic.json`, `project.json`, `TASK.md`, `EPIC.md`, and `qa/Q-<n>/QA.md`. |
| `shared/.internal/catalog.lock` | All projects | Project create, rename, and delete, after checking name uniqueness. |
| `lifecycle.lock` | The data area | Held by `serve` from start to exit so only one server runs (see [Server and web UI](./server-and-ui.md#starting-and-stopping-serve)). |
| `autostart.lock` | The data area | Taken by a command that starts the server, and handed to that server until it is ready, so commands started together start only one. A command waits up to 40 seconds for it. |

- All are standard file locks. A writer waits up to **5 seconds** for the project lock, then fails with `database_busy` (exit code 1) and changes nothing. Agents may simply retry.
- Under the lock a writer re-reads the latest files, changes only what it needs, and replaces each file by renaming a temporary file written in the same folder.
- A task's lock is held from reading the latest JSON and Markdown until the pair is committed and any recovery is finished. Public task reads, snapshots, and version computation read the pair under the same lock, so they never see a half-written pair. Internal reads during a state update do not take the lock again.
- When the server index is involved, locks are taken in the order index, then project. State updates release the project lock before updating the index and notifying.
- **Direct edits take no lock.** An editor that saves `TASK.md` or `EPIC.md` is not coordinated with the CLI; the last save wins. Board files have no revision-number conflict detection; only [project docs](#project-docs) do.

## Saving a task

A task's state (`task.json`) and its history (`TASK.md`) must never disagree, so they are committed as one pair through a durable journal in `.internal/transactions/`:

1. Under the project lock, read the latest pair and compute the new contents.
2. Write a journal entry with the old and new contents, relative paths, hashes, and `prepared`, and sync it.
3. Replace both files from temporary files and sync the parent folder.
4. Sync `committed` in the journal. **This is the commit point.**
5. Remove the journal, update the index, and notify. Responses and `changed` notifications happen only after commit.

Recovery follows from the commit point:

- A failure before `committed` restores the old pair while the lock is still held.
- After a crash, the next read or write recovers under the project lock before it proceeds: `prepared` goes back to the old pair, `committed` keeps the new pair.
- A failure to clean up the journal after commit does not make the operation uncommitted.
- If a direct edit no longer matches the journal's expected hashes, the journal does not overwrite it; `file_error` is reported. If recovery is impossible, the journal is kept and that pair is neither published nor changed further.
- Journals never count toward `version` or `cursor`.

Everything that changes a task goes through this path: state changes, answers, draft toggles, epic changes, archive, restore, automatic Done, and `history add`. Each keeps the latest body, acceptance, and unknown frontmatter keys. `history add` checks the AI guards (Done, draft, archive) under the lock and refuses invalid history without changing anything.

### Saving messages

Asking, answering, accepting, withdrawing, and linking messages can change several `QA.md` files and several task pairs at once. These are committed as one change through a journal in `.internal/batches/` that lists every target file with its old and new contents (none for a file that does not exist before or after). The phases and recovery match the task journal: `prepared` rolls back to the old files, `committed` keeps the new ones, and bytes that no longer match block recovery rather than overwrite a direct edit. A request sent from the board is published with one rename of `qa/Q-<n>/`, so it is never seen without its images. The message numbers are reserved in `project.json` before the files are written, so a failed ask can leave numbers unused. An answer writes its images before the batch and removes them only when the batch fails before its commit point; once `committed` is written, recovery keeps the replies, so the images they name stay.

The first time a project is read or written, under its lock, Agent Board converts data left by an earlier format once. Questions that were still open become `qa/Q-<n>/QA.md` with the same number, and answered and withdrawn ones are dropped. A start approval is not carried over: the AI tasks that waited on it move to the Backlog, and a person sends them to Todo again. References to dropped questions leave the tasks. A `qa/` folder that cannot be read is moved to `.internal/legacy-qa/`. After that only the current format is read.

Only the `TASK.md`/`task.json` pair, and a message change with the task pairs it touches, are atomic. Images, `EPIC.md`, and `epic.json` are saved separately; if a task save fails after its images were saved, the response states what was saved and the UI keeps the input. A web save of a task composes the whole `TASK.md` from frontmatter and body, validates it, and writes it once; if validation fails nothing is written. Unknown keys are preserved, key order follows the YAML writer, and comments are not preserved.

## Format versions and old AI drafts

A `task.json` or `epic.json` that uses the Backlog has `formatVersion: 2`; the files of ordinary cards stay at `formatVersion: 1`, and both are read. Any other version is `format_unsupported`, and the message says "Only formatVersion 2 is supported". An earlier version of `agboard` cannot read a version-2 file.

The `draft: "ai"` mark of earlier versions is no longer read. The board does not convert it: a `task.json` or `epic.json` that still holds it fails to parse like any other invalid file, so it is reported in `problems` (and by `agboard show`/`ls` for a single file), left out of the board, and never rewritten. Nothing else in the project is affected.

The conversion is a one-shot script, `scripts/migrate-ai-drafts.mjs`, run by hand while `agboard serve` is stopped. It refuses to run while `serve.json` names a live process or while a project has an unfinished save in `.internal/transactions`. It writes each file through a temporary file in the same folder and a rename, and a second run changes nothing. `--dry-run` lists what would change. It also removes the unused `.internal/backlog-migrated` marker of the earlier automatic conversion.

| Before | After |
| --- | --- |
| Task with `draft: ai` in Todo or Doing, not archived | `taskStatus: backlog`, `draft: null`, run state Idle, `formatVersion: 2`, and the history entry `Moved the AI draft from <lane> to the Backlog.` |
| Task with `draft: ai` that is Done or archived | Only `draft: null` |
| Epic with `draft: ai` | `draft: null` |
| `draft: human`, the old `isDraft`, and ordinary cards | Unchanged |

The script does not make an old plan startable: only a person can send it to Todo.

## Creating and deleting

- Creating a task reserves `nextTaskId` under the lock, writes `task.json` and `TASK.md` (with its generated creation entry) into `tasks/.new-<random>/`, and renames the folder to `tasks/<task-id>/`. Epics work the same way. A failure never exposes a half-created task; the reserved number stays unused.
- `init` renames the project's `tasks/`, `epics/`, and `qa/` to temporary names before deleting them, keeping the ID, name, `nextTaskId`, and `nextQuestionId`.
- `init` and `project rm` delete the named project's data, including archived tasks and images, and nothing else.
- Bulk archive commits task by task; there is no rollback across tasks.

### Creating a task from a short request

The short request form sends the description, optional epic, and images together through `POST /api/projects/{projectId}/tasks/multipart`. FileStore validates the project, epic, description, and every image under one project lock. Each accepted submission creates a new task; the server does not compare content to recognize retries, so resubmitting after an uncertain network failure can create a second task.

The task metadata and body are written into a private staging directory, followed by the image files. One same-filesystem directory rename publishes the complete task. Until that rename, task listing and the wait selector cannot see it. The success response and change notification happen after publication. A failure removes the staging directory; an already-reserved task number may remain unused. This path creates an AI-owned Todo task and keeps the submitted text under `## 元の依頼`; creating a task with its own metadata, and editing, retain their existing behavior.

## Project docs

Agent Board never writes the files in `shared/projects/<project-id>/docs/`, apart from the `README.md` it puts there when it creates the folder. The Docs dialog only reads them, and the user edits them in their own editor (**Open in editor** starts it, see [Web API](../reference/web-api.md#project-docs)). So the docs have no lock, journal, revision check, or recovery of their own; the editor that writes a file is responsible for it.

The board's data is not affected by the docs either: the watcher reports a change in `docs/` as an SSE `docs` event, without reloading the board, changing the project's `version`, or sending `changed` (see [Change notifications](./notifications.md#the-docs)).

## When files are invalid

The product never repairs files on its own. It reports what is wrong, keeps showing what it can, and refuses writes that would build on a broken file.

| Defect | Effect |
| --- | --- |
| Unreadable file | `file_unreadable` with the relative path; nothing is written. |
| Invalid `task.json` | That task is left out of `tasks` and listed in `problems`; writes to it fail with `file_invalid`. |
| `formatVersion` other than 1 or 2 | Listed as `format_unsupported` and left out; the file is never converted, deleted, or rewritten. |
| Invalid `project.json` | The whole read of that project fails with `file_invalid`. |
| Unparsable YAML in `TASK.md` | The text after the closing line (or the whole file) is shown as the body, with empty `acceptance` and `acceptanceError: true`. Updates are refused for every actor. |
| Invalid `acceptance` only | Body and history still work. AI moves to Done are refused because unmet conditions cannot be ruled out; people's moves still work. |
| Invalid `history` only | The body and valid acceptance stay readable; history is returned as empty but never saved from that value. Strict reads, updates, answers, and automatic Done are refused. |
| Body format defects | The body is shown as is, with the defect in `problems`. |

While a project has defects, the `serve` index keeps the last good view and returns the defect as an error. Once the file is fixed by hand, the next read shows it normally.

## The first-run guide's state

The first-run guide runs in the web UI. The server keeps one fact for the whole shared directory: whether this data area has already seen the guide. It is stored in `shared/.internal/onboarding.json` as `{ "formatVersion": 2, "status": "unseen" | "completed" | "skipped" }`.

`GET /api/onboarding` reads it, and `POST /api/onboarding/seen` with `{ "outcome": "completed" | "skipped" }` records how the guide ended. A later call replaces the earlier outcome, so finishing a replay after a skip records `completed`. Both take the guide lock and save the file atomically.

Releases before this format kept a whole run in the file, with sample cards on the board. Version 1 of the file is read as follows: `completed` and `skipped` keep their meaning, and every other status is `unseen`. If the old file names a run that was still open (`offered`, `active`, `closing`, or `interrupted`), its sample cards are archived once, and then the file is rewritten as version 2. This happens when the server starts, and on the first read if the file has not been rewritten yet. If archiving fails, the old file stays, and the next read tries again.

## Failure behavior at a glance

| Situation | What happens |
| --- | --- |
| `serve` is not running, `serve.json` is stale, or a notification is lost | The CLI still succeeds and keeps the save. Changes are picked up from OS events, or when the server starts. |
| `serve` crashed and left `serve.json` | CLI notifications fail to connect and are ignored; the next `serve` overwrites the file. A command that needs the server starts a new one, because the pid is gone or `lifecycle.lock` is free. |
| The pid in `serve.json` is alive and holds `lifecycle.lock` but does not answer | A command that needs the server waits up to 10 seconds, then fails with `board_unavailable` naming the pid and `agboard stop`. It does not start a second server. |
| An automatic server could not start | The command fails with `board_unavailable` that names `serve.log`, or with `local_network_denied` or `port_in_use`. Nothing was saved. |
| The watcher cannot be registered | `serve` exits with an error. |
| The watcher reports an error while running | Every project is reloaded and the error is logged. |
| The OS drops events and asks for a rescan | Every project is reloaded. |
| An editor overwrites a file in place without a temporary file | A half-written body may appear briefly in `problems`, until the event for the finished write triggers a reload. |
| The project lock is busy for more than 5 seconds | `database_busy`; nothing changes; retry. |
| An agent crashes while its task is Running | The task stays Running. Nothing resets it automatically. |
| The shared area is on a network drive | Not supported: OS events may not arrive. |

Browser-side failures (lost responses, retries, disconnects) are covered in [Server and web UI](./server-and-ui.md#behavior-on-failure-in-the-ui).
