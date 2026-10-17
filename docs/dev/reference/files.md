# Shared files

Every file Agent Board stores, with its fields and an example. For how the files are used, see [Tasks and states](../concepts/tasks-and-states.md) and [Saving and recovery](../concepts/saving-and-recovery.md).

## Tasks

A task is one unit of work on the board. A task's state lives in `task.json`; its body, acceptance conditions, and history live in `TASK.md`.

| Field | Rule |
| --- | --- |
| `id` | Positive integer, unique on the board, equal to the folder name. |
| `title` | 1 to 100 characters after trimming, one line. |
| `description` | The whole `TASK.md`, frontmatter included. Only the body counts toward its 50,000-character limit. CRLF is normalized to LF. |
| `body` | `description` without frontmatter: GitHub Flavored Markdown with no required headings. |
| `acceptance`, `acceptanceError` | The acceptance items from frontmatter (empty when invalid), and whether `acceptance` or the YAML syntax is invalid. |
| `assignee` | `ai` or `human`. Set at creation and fixed afterwards. |
| `epicId` | An EPIC-ID in the same project, or `null`. |
| `taskStatus` | The lane: `todo`, `doing`, or `done`. |
| `position` | Positive integer, unique among unarchived tasks in the same lane. |
| `agentStatus` | The AI run state: `idle`, `running`, or `pending`. |
| `isDraft` | Defaults to `false`. A draft is being prepared by a person. |
| `pendingRequestId`, `pendingRequest` | The open decision request while Pending; otherwise `null`. |
| `requestAnswers` | Answers kept for lookup by request ID, including after a restart. |
| `archivedAt` | `null`, or the archive time. |
| `attachments`, `evidence` | ID, name, size, and creation time of each file (images also have a MIME type). |
| `createdAt`, `updatedAt` | Creation time; when read, the later of the `task.json` and `TASK.md` modification times. |
| `agentStatusChangedAt`, `taskStatusChangedAt` | Last run-state change and last real lane change. Body edits, progress records, and same-lane operations do not change `taskStatusChangedAt`. |
| `history` | Read from `TASK.md`; stored and returned oldest first. |

Lengths are counted in Unicode scalar values. The `assignee` (who owns the task) is different from the `actor` (who performs an operation). The actor decides permissions and is never stored in history.

## Files on disk

The data area is `.agent-board/` in the home directory on every OS, or a non-empty `AGBOARD_HOME`. If the home directory cannot be resolved, the command fails instead of using the working folder.

```text
<data-root>/
  shared/
    workspace.json
    projects/
      <project-id>/
        project.json
        README.md
        epics/<EPIC-ID>/{epic.json, PLAN.md, assets/<attachment-id>.<ext>}
        tasks/<task-id>/{task.json, TASK.md, assets/<attachment-id>.<ext>, evidence/<evidence-id>.log}
        .internal/write.lock
        .internal/transactions/<transaction-id>.json
  bindings.json
  serve.json
  lifecycle.lock
```

- JSON is UTF-8, camelCase, two-space indented, with one trailing newline. Unknown fields are rejected.
- `workspace.json` is `{"format":"agboard-files","formatVersion":1}`. `project.json` and `epic.json` have `formatVersion: 1`; `task.json` has `formatVersion: 1` too. Every file uses version 1; any other version is rejected with `format_unsupported`, reported, and left untouched. There is no migration or fallback.
- Names starting with `.` are not source files. `README.md` describes the folder and its editing rules; the product writes it at creation.
- Images live in the owner's `assets/` and evidence in the task's `evidence/`. Bodies reference images as `assets/<attachment-id>.<ext>` (or the older `attachment:<id>`). Images are PNG, JPEG, WebP, or GIF; at most 10 MiB each, 20 per owner, and 50 MiB in total.
- `bindings.json` and `serve.json` are machine-local. `serve.json` (`{"pid":41235,"port":7420,"started_at":"..."}`) tells the CLI where to notify and `wait` where to connect; it never holds a token.

`project.json` holds `formatVersion`, `id`, `name`, `createdAt`, `nextTaskId`, and `defaultEpicsSeeded`. The last one is `true` once the project has been offered the default epics `BUG` and `ENHANCEMENT`; it is written once, so a default epic that was deleted is not created again. A file without it is read as `false`. `epic.json` holds `formatVersion`, `id`, `name`, `color`, `isDraft`, `attachments`, `createdAt`, and `updatedAt`. A `task.json` looks like this:

```json
{
  "formatVersion": 1,
  "id": 1,
  "title": "Implement the answer UI",
  "assignee": "ai",
  "epicId": null,
  "taskStatus": "todo",
  "agentStatus": "idle",
  "position": 1,
  "isDraft": false,
  "archivedAt": null,
  "pendingRequestId": null,
  "pendingRequest": null,
  "requestAnswers": [],
  "createdAt": "2026-10-10T00:00:00Z",
  "updatedAt": "2026-10-10T00:00:00Z",
  "agentStatusChangedAt": "2026-10-10T00:00:00Z",
  "taskStatusChangedAt": "2026-10-10T00:00:00Z",
  "attachments": [],
  "evidence": []
}
```

- `pendingRequest` is `{question, choices}` with choices like `[{"id":"proceed","label":"Proceed"}]`.
- Each `requestAnswers` item is `{requestId, actor, choiceId, choiceLabel, text, at}`. `choiceId` and `choiceLabel` are both `null` or both set; `text` is `null` or a valid answer; at least one of choice or text is present. `requestId` is unique and differs from the current `pendingRequestId`.

In `TASK.md`, `history` is required (`history: []` is valid). New-task input may omit it or pass an empty list; non-empty history in creation input is rejected. Body and acceptance edits keep the latest history, and `edit --desc-file` never appends. A direct append may add only `at`/`reason` entries while keeping everything else; the CLI is preferred because it handles time and atomicity.

```yaml
---
acceptance: []
history:
  - at: "2026-10-15T01:30:00Z"
    reason: "Verified the setup guide links and saved the build output as evidence."
---
```

Back up a project by copying `shared/projects/<project-id>/`; restore it by stopping `serve` and putting the folder back. There are no export or import commands. See the [data guide](../../guide/operations/data.md).

## Task JSON and snapshots

The CLI, web API, and hook share one camelCase task representation: the `task.json` metadata plus `history`, `description`, `body`, `acceptance`, `acceptanceError`, the resolved `pendingReason` and `pendingChoices`, the displayed `updatedAt`, and `epic` (`{id, name, color}` or `null`). `pendingRequest` and `requestAnswers` never appear in history. A waiting `state ... --request-json` returns the resolved answer separately as `answer`.

- A snapshot returns `project`, `version`, `cursor`, `epics`, `tasks` (each with full history), and `problems` from a single read. The CLI snapshot also includes `nextTaskId`; CLI snapshots, the hook, and `wait` include `fetchedAt`.
- The project list returns `projects` (id, name, createdAt) and `catalogVersion`, without tasks.
- `ls --all-projects --json` returns `catalogVersion` and one snapshot per project, sorted by name, each with its own cursor.

`problems` report format defects: `[{ "file": "projects/<id>/tasks/12/TASK.md", "field": "acceptance[1].text", "reason": "The text must not be empty." }]`. `field` is `frontmatter`, `acceptance[<index>].<key>`, `history`, or `history[<index>].<key>`; `file` is relative to `shared/`; `reason` is English. How defects affect reads and writes is described in [Storage and consistency](../concepts/saving-and-recovery.md#when-files-are-invalid).

## Folder bindings

A folder binding maps a real folder to a ProjectId so the hook and `agboard progress` know which project a working folder belongs to. It is stored only in the machine-local data area, never in the shared area or tracked files. Because it stores the ProjectId, it follows renames and never moves to a re-created project with the same name. The nearest bound ancestor folder wins. Missing folders, broken bindings, and deleted ProjectIds are explained errors.
