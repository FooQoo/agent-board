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
| `attachments` | ID, name, size, MIME type, and creation time of each image. |
| `simpleRequest` | Legacy optional metadata `{requestId, payloadHash}` from older short-request submissions. New tasks do not write or use it. |
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
        docs/<any folders>/<name>.md
        epics/<EPIC-ID>/{epic.json, EPIC.md, assets/<attachment-id>.<ext>}
        tasks/<task-id>/{task.json, TASK.md, assets/<attachment-id>.<ext>}
        .internal/write.lock
        .internal/transactions/<transaction-id>.json
  bindings.json
  serve.json
  serve.log
  lifecycle.lock
  .internal/monitor-connection.json
  .internal/preferences.json
```

- JSON is UTF-8, camelCase, two-space indented, with one trailing newline. Unknown fields are rejected.
- `workspace.json` is `{"format":"agboard-files","formatVersion":1}`. `project.json` and `epic.json` have `formatVersion: 1`; `task.json` has `formatVersion: 1` too. Every file uses version 1; any other version is rejected with `format_unsupported`, reported, and left untouched. There is no migration or fallback.
- Names starting with `.` are not source files. `README.md` describes the folder and its editing rules; the product writes it at creation.
- Images live in the owner's `assets/`. Bodies reference images as `assets/<attachment-id>.<ext>` (or the older `attachment:<id>`). Images are PNG, JPEG, WebP, or GIF; at most 10 MiB each, 20 per owner, and 50 MiB in total.
- `bindings.json` and `serve.json` are machine-local. `serve.json` (`{"pid":41235,"port":7420,"started_at":"..."}`) tells the CLI where to notify and `wait` where to connect; it never holds a token. `serve.log` is the output of a server started with `serve -d` (owner-only, replaced at every start); `agboard stop` finds the server through `serve.json`.

`docs/` holds the project's own Markdown documents, which the Docs dialog reads and edits (see [Project docs](#project-docs)).

`project.json` holds `formatVersion`, `id`, `name`, `createdAt`, `nextTaskId`, and `defaultEpicsSeeded`. The last one is `true` once the project has been offered the default epics `BUG` and `ENHANCEMENT`; it is written once, so a default epic that was deleted is not created again. A file without it is read as `false`. `epic.json` holds `formatVersion`, `id`, `name`, `color`, `isDraft`, `attachments`, `createdAt`, and `updatedAt`.

`EPIC.md` holds the epic's details in Markdown, frontmatter included. Its frontmatter may hold `priority`, the list of task IDs in work order. The API and `epic show --json` return the whole text as `document`, the text without frontmatter as `body`, and the parsed order as `priority`. Earlier versions named this file `PLAN.md`; the first read of a project renames it to `EPIC.md`, as described in the [data guide](../../guide/operations/data.md).

A `task.json` looks like this:

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
  "attachments": []
}
```

- `pendingRequest` is `{question, choices}` with choices like `[{"id":"proceed","label":"Proceed"}]`.
- Each `requestAnswers` item is `{requestId, actor, choiceId, choiceLabel, text, at}`. `choiceId` and `choiceLabel` are both `null` or both set; `text` is `null` or a valid answer; at least one of choice or text is present. `requestId` is unique and differs from the current `pendingRequestId`.
- Older short-request tasks may contain `simpleRequest` metadata. It remains readable for compatibility but new tasks do not write or use it to detect repeats.

In `TASK.md`, `history` is required (`history: []` is valid). New-task input may omit it or pass an empty list; non-empty history in creation input is rejected. Body and acceptance edits keep the latest history, and `edit --desc-file` never appends. A direct append may add only `at`/`reason` entries while keeping everything else; the CLI is preferred because it handles time and atomicity.

```yaml
---
acceptance: []
history:
  - at: "2026-10-15T01:30:00Z"
    reason: "Verified the setup guide links and recorded the result in the task body."
---
```

Back up a project by copying `shared/projects/<project-id>/`; restore it by stopping `serve` and putting the folder back. There are no export or import commands. See the [data guide](../../guide/operations/data.md).

## Monitor connection settings

The ngrok mobile connection keeps its non-secret settings in `<data-root>/.internal/monitor-connection.json`. The file belongs to the application: it is written only by the PC settings screen and `serve`, not by hand, and it is not part of the shared area, so it is not backed up with a project. It is replaced atomically with owner-only permissions (`0600` where the OS has them).

```json
{
  "formatVersion": 1,
  "revision": 3,
  "enabled": true
}
```

| Field | Rule |
| --- | --- |
| `formatVersion` | Always `1`. Any other value, an unknown field, or a malformed file makes the settings unreadable (`config_unreadable`); the PC entrance keeps working and saving new settings replaces the file. |
| `revision` | Increases with each save. The settings API uses it to detect a change made on another screen. |
| `enabled` | Whether the connection starts again with the next `serve`. A stop saves `false`. |

The file never holds the ngrok token, the phone passcode, a session, or a CSRF token. A token the user chooses to save lives in the PC's secure storage (the OS credential store) instead (service `agent-board`, account `ngrok-authtoken`). There is no `monitor/config.json`.

## Display preferences

The saved language and color theme live in `<data-root>/.internal/preferences.json`. The file belongs to the application: it is written only by `PUT /api/preferences` on the PC and by the monitor's save route, never by hand. It is not in `shared/`, so a project backup does not include it. It is replaced atomically with owner-only permissions (`0600` where the OS has them), and a failed write leaves the old file as it was.

```json
{
  "formatVersion": 1,
  "revision": 4,
  "locale": "ja",
  "theme": {
    "mode": "dark",
    "accent": "teal"
  }
}
```

| Field | Rule |
| --- | --- |
| `formatVersion` | Always `1`. Any other value, an unknown field, or a malformed file is read as the defaults, and the next save replaces the file. |
| `revision` | `0` when nothing is saved, and goes up by one with each save. |
| `locale` | `en` or `ja`. The default is `en`. |
| `theme.mode` | `light` or `dark`. The default is `light`. |
| `theme.accent` | One of the 12 accents: `blue`, `sky`, `cyan`, `teal`, `green`, `lime`, `yellow`, `orange`, `red`, `pink`, `purple`, `gray`. The default is `blue`. |

A save changes only the fields it sends; the others keep their saved values. The last save wins, and there is no conflict check. The preferences hold no secret, and the file never holds a token, a passcode, or a session.

## Task JSON and snapshots

The CLI, web API, and hook share one camelCase task representation: the `task.json` metadata plus `history`, `description`, `body`, `acceptance`, `acceptanceError`, the resolved `pendingReason` and `pendingChoices`, the displayed `updatedAt`, and `epic` (`{id, name, color}` or `null`). `pendingRequest` and `requestAnswers` never appear in history. A waiting `state ... --request-json` returns the resolved answer separately as `answer`.

- A snapshot returns `project`, `version`, `cursor`, `epics`, `tasks` (each with full history), and `problems` from a single read. The CLI snapshot also includes `nextTaskId`; CLI snapshots, the hook, and `wait` include `fetchedAt`.
- The project list returns `projects` (id, name, createdAt) and `catalogVersion`, without tasks.
- `ls --all-projects --json` returns `catalogVersion` and one snapshot per project, sorted by name, each with its own cursor.

`problems` report format defects: `[{ "file": "projects/<id>/tasks/12/TASK.md", "field": "acceptance[1].text", "reason": "The text must not be empty." }]`. `field` is `frontmatter`, `acceptance[<index>].<key>`, `history`, or `history[<index>].<key>`; `file` is relative to `shared/`; `reason` is English. How defects affect reads and writes is described in [Storage and consistency](../concepts/saving-and-recovery.md#when-files-are-invalid).

## First-run guide

- `shared/.internal/onboarding.json`: the guide's status, lease owner, active run, and recent command IDs. See [saving and recovery](../concepts/saving-and-recovery.md).
- `tasks/<id>/task.json` `onboardingSample`: `{ "runId": "<32 lowercase hex>", "ordinal": 1 | 2 }`. Present only on the guide's sample cards.

## Folder bindings

A folder binding maps a real folder to a ProjectId so the hook and `agboard progress` know which project a working folder belongs to. It is stored only in the machine-local data area, never in the shared area or tracked files. Because it stores the ProjectId, it follows renames and never moves to a re-created project with the same name. The nearest bound ancestor folder wins. Missing folders, broken bindings, and deleted ProjectIds are explained errors.

## Project docs

`shared/projects/<project-id>/docs/` is the project's document folder. It belongs to the user, not to the board: its files have no format, no `formatVersion`, and no fields, and Agent Board never validates them.

- **Created with the project.** `project create`, and `init` when it creates the project, build `docs/` inside the new project's temporary folder, with a `README.md`, before the folder is renamed into place. The README is English or Japanese, following the app's language in `.internal/preferences.json` (`ja` gives Japanese; anything else, English). Its text is in `src/docs/templates/`.
- **Filled in at startup.** `serve` creates `docs/` and its README for every project that has no `docs/` folder. A folder that exists is left alone, so a README the user deleted stays deleted. A failure here is skipped, because a missing folder reads as an empty tree.
- **Deleted with the project.** `project rm` removes the whole project folder, `docs/` included. Nothing is kept aside. `init` on an existing project resets only `tasks/` and `epics/`, so `docs/` stays.
- **Not board data.** The watcher ignores everything under `docs/`, and the files are not part of the project's `version` (see [Change notifications](../concepts/notifications.md)). Editing them never sends `changed`.
- **Read and written only through the Docs routes.** The tree lists folders and files; the file routes read and save `.md` and `.mdx` files of at most 2 MiB in UTF-8; the image route serves PNG, JPEG, WebP, GIF, AVIF, and SVG up to 10 MiB. See [Web API](./web-api.md#project-docs).
- **Saved as sent.** A save writes the bytes it receives, with no change to line endings, a BOM, the final newline, or the front matter. The revision a save names is `sha256:` and the hex SHA-256 of those bytes.
