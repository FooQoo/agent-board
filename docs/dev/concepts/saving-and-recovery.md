# Saving and recovery

Several agents, the CLI, the web server, and text editors may touch the same files at once. This page explains how Agent Board keeps the files consistent and what happens when something goes wrong. If you are debugging a failure, also read [Troubleshooting](../troubleshooting.md).

## Locks

| Lock | Scope | Used for |
| --- | --- | --- |
| `.internal/write.lock` | One project | Every CLI and web write: `task.json`, `epic.json`, `project.json`, `TASK.md`, and `EPIC.md`. |
| `shared/.internal/catalog.lock` | All projects | Project create, rename, and delete, after checking name uniqueness. |
| `lifecycle.lock` | The data area | Held by `serve` from start to exit so only one server runs (see [Server and web UI](./server-and-ui.md#starting-and-stopping-serve)). |

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

Only the `TASK.md`/`task.json` pair is atomic. Images, `EPIC.md`, and `epic.json` are saved separately; if a task save fails after its images were saved, the response states what was saved and the UI keeps the input. A web save of a task composes the whole `TASK.md` from frontmatter and body, validates it, and writes it once; if validation fails nothing is written. Unknown keys are preserved, key order follows the YAML writer, and comments are not preserved.

## Creating and deleting

- Creating a task reserves `nextTaskId` under the lock, writes `task.json` and `TASK.md` (with its generated creation entry) into `tasks/.new-<random>/`, and renames the folder to `tasks/<task-id>/`. Epics work the same way. A failure never exposes a half-created task; the reserved number stays unused.
- `init` renames the project's `tasks/` and `epics/` to temporary names before deleting them, keeping the ID, name, and `nextTaskId`.
- `init` and `project rm` delete the named project's data, including archived tasks and images, and nothing else.
- Bulk archive commits task by task; there is no rollback across tasks.

### Creating a task from a short request

The short request form sends the description, optional epic, and images together through `POST /api/projects/{projectId}/tasks/multipart`. FileStore validates the project, epic, description, and every image under one project lock. Each accepted submission creates a new task; the server does not compare content to recognize retries, so resubmitting after an uncertain network failure can create a second task.

The task metadata and body are written into a private staging directory, followed by the image files. One same-filesystem directory rename publishes the complete task. Until that rename, task listing and the wait selector cannot see it. The success response and change notification happen after publication. A failure removes the staging directory; an already-reserved task number may remain unused. This path creates an AI-owned Todo task and keeps the submitted text under `## 元の依頼`; normal manual task creation and editing retain their existing behavior.

## Project docs

The files in `shared/projects/<project-id>/docs/` are saved by their own path, apart from the board's locks and journal. A save is a compare-and-swap on the file's revision (`src/docs/writer.rs`):

1. The page reads a file and keeps its `revision`, the SHA-256 of its bytes.
2. A save sends the new content with that revision as `expectedRevision`.
3. The server takes a mutex for the project's `docs/` folder. The mutex lives in the `serve` process; it is not a file lock.
4. Under the mutex it opens the file, reads its bytes, and computes the current revision. If the file is gone, the save is `docs_not_found`; saving never creates a file. If the revision differs, it is `docs_revision_conflict` with `currentRevision`, and nothing is written. A read-only file is `docs_read_only`.
5. Otherwise it writes the content to a temporary file in the same folder, syncs it, and renames it over the file. The content is written as the exact bytes received, so line endings, a BOM, the final newline, and the front matter stay as the page sent them.
6. It returns the new revision, which the page keeps for its next save.

The page splits the front matter off before editing and puts the original text back above the edited body when it saves, so the front matter is never rewritten. A file that is opened and closed without an edit is never saved. After an edit, the editor writes the body in its own Markdown style; the list is in the [user guide](../../guide/use/docs.md#formatting-that-changes-when-you-save).

On a conflict, the page keeps the user's text and offers to reload the latest file or to save again with `currentRevision` as the expected revision, which overwrites the other change.

Limits of this design:

- **Other processes are not coordinated.** An editor, `git`, or an agent writing the file does not take the mutex. A write that lands between the server's comparison and its rename is overwritten without a conflict. A write before the comparison is caught.
- **One server only.** The mutex orders saves inside one `serve`. Only one `serve` runs per data area, so this covers every save made through the API.
- **No history.** An overwrite replaces the file; there is no backup or undo. Keep documents that matter under version control.

Saving a document does not touch the board: the watcher ignores `docs/`, the project `version` does not change, and no `changed` is sent.

## When files are invalid

The product never repairs files on its own. It reports what is wrong, keeps showing what it can, and refuses writes that would build on a broken file.

| Defect | Effect |
| --- | --- |
| Unreadable file | `file_unreadable` with the relative path; nothing is written. |
| Invalid `task.json` | That task is left out of `tasks` and listed in `problems`; writes to it fail with `file_invalid`. |
| `formatVersion` other than 1 | Listed as `format_unsupported` and left out; the file is never converted, deleted, or rewritten. |
| Invalid `project.json` | The whole read of that project fails with `file_invalid`. |
| Unparsable YAML in `TASK.md` | The text after the closing line (or the whole file) is shown as the body, with empty `acceptance` and `acceptanceError: true`. Updates are refused for every actor. |
| Invalid `acceptance` only | Body and history still work. AI moves to Done are refused because unmet conditions cannot be ruled out; people's moves still work. |
| Invalid `history` only | The body and valid acceptance stay readable; history is returned as empty but never saved from that value. Strict reads, updates, answers, and automatic Done are refused. |
| Body format defects | The body is shown as is, with the defect in `problems`. |

While a project has defects, the `serve` index keeps the last good view and returns the defect as an error. Once the file is fixed by hand, the next read shows it normally.

## The first-run guide's state

The guide keeps one file for the whole shared directory, `shared/.internal/onboarding.json`. It holds the status (`unseen`, `offered`, `active`, `closing`, `completed`, `interrupted`, or `skipped`), the tab that holds the lease and when it expires, the active run with its phase and sample card IDs, and the most recent command IDs that were applied.

Each operation takes the guide lock and then the project lock. A command that changes the state saves the file atomically with a new revision. A request names the revision it read and a command ID. A repeated command returns the current state without repeating the step, and a request that names an old revision is refused.

A tab holds the lease for 30 seconds and renews it with a heartbeat every 10 seconds. A heartbeat extends the lease without changing the revision. When the server starts, and when a recovery request arrives, a run whose lease has expired is ended: its cards are archived, and the guide becomes `interrupted`. The board also sends a recovery request when its first read finds an `active` guide whose lease has expired or has no owner, which is what a closed or reloaded tab leaves behind. A lease that is still live belongs to another tab and is left alone.

## Failure behavior at a glance

| Situation | What happens |
| --- | --- |
| `serve` is not running, `serve.json` is stale, or a notification is lost | The CLI still succeeds and keeps the save. Changes are picked up from OS events, or when the server starts. |
| `serve` crashed and left `serve.json` | CLI notifications fail to connect and are ignored; the next `serve` overwrites the file. |
| The watcher cannot be registered | `serve` exits with an error. |
| The watcher reports an error while running | Every project is reloaded and the error is logged. |
| The OS drops events and asks for a rescan | Every project is reloaded. |
| An editor overwrites a file in place without a temporary file | A half-written body may appear briefly in `problems`, until the event for the finished write triggers a reload. |
| The project lock is busy for more than 5 seconds | `database_busy`; nothing changes; retry. |
| An agent crashes while its task is Running | The task stays Running. Nothing resets it automatically. |
| The shared area is on a network drive | Not supported: OS events may not arrive. |
| A docs file changed since the page read it | The save is refused with `docs_revision_conflict`; the file is unchanged and the page keeps the text. |

Browser-side failures (lost responses, retries, disconnects) are covered in [Server and web UI](./server-and-ui.md#behavior-on-failure-in-the-ui).
