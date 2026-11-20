# Shared files

Every file Agent Board stores, with its fields and an example. For how the files are used, see [Tasks and states](../concepts/tasks-and-states.md) and [Saving and recovery](../concepts/saving-and-recovery.md).

## Tasks

A task is one unit of work on the board. A task's state lives in `task.json`; its body, acceptance conditions, and history live in `TASK.md`.

| Field | Rule |
| --- | --- |
| `id` | Positive integer, unique on the board, equal to the folder name. |
| `title` | 1 to 100 characters after trimming, one line. |
| `description` | The whole `TASK.md`, frontmatter included. Only the body counts toward its 50,000-character limit. CRLF is normalized to LF. |
| `body` | `description` without frontmatter: GitHub Flavored Markdown with no required headings. The task template recommends `Background`, `What to do`, `Approach`, and `Verification results` headings, but nothing validates them. |
| `acceptance`, `acceptanceError` | The acceptance items from frontmatter (empty when invalid), and whether `acceptance` or the YAML syntax is invalid. |
| `assignee` | `ai` or `human`. Set at creation and fixed afterwards. |
| `epicId` | An EPIC-ID in the same project, or `null`. |
| `taskStatus` | The lane: `todo`, `doing`, or `done`. |
| `position` | Positive integer, unique among unarchived tasks in the same lane. |
| `agentStatus` | The AI run state. `task.json` stores `idle` or `running`; reads return `pending` while an AI task in Todo or Doing waits for a person (see [Messages](../concepts/history-and-decisions.md#messages)). A stored `pending` reads as `idle`. |
| `draft` | `null`, `"human"`, or `"ai"`. `human` is a draft a person is writing in the browser; `ai` is a proposal an agent created, which the agent starts once its questions are answered (a person can start it too). Files of earlier versions hold `isDraft`: `true` reads as `human` and `false` as `null`; writing uses `draft` only. For an epic, the CLI `epic edit` refuses a `human` draft with `epic_is_draft`. |
| `questions` | In `TASK.md` frontmatter: the IDs of the project questions the task refers to, such as `[Q-12, Q-15]`. Omitted, `null`, and empty all mean none; duplicates are rejected. |
| `requestAnswers` | Answers recorded by earlier versions of Agent Board, kept as a record. Nothing adds to it. |
| `archivedAt` | `null`, or the archive time. |
| `attachments` | ID, name, size, MIME type, and creation time of each image. |
| `results` | The results delivered to the requester, oldest first (`[]` when none). See [Results](#results). |
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
        qa/Q-<n>/{QA.md, attachments/<name>}
        .internal/write.lock
        .internal/transactions/<transaction-id>.json
        .internal/batches/<batch-id>.json
  bindings.json
  serve.json
  serve.log
  resident/<tool>.log
  lifecycle.lock
  autostart.lock
  autostart.paused
  .internal/monitor-connection.json
  .internal/notification-settings.json
  .internal/push-ledger.json
  .internal/preferences.json
  .internal/remote-devices.json
  .internal/resident-autostart.json
```

- JSON is UTF-8, camelCase, two-space indented, with one trailing newline. Unknown fields are rejected.
- `workspace.json` is `{"format":"agboard-files","formatVersion":1}`. `project.json` and `epic.json` have `formatVersion: 1`; `task.json` has `formatVersion: 1` too. Every file uses version 1; any other version is rejected with `format_unsupported`, reported, and left untouched. There is no migration or fallback.
- Names starting with `.` are not source files. `README.md` describes the folder and its editing rules; the product writes it at creation.
- Images live in the owner's `assets/`. Bodies reference images as `assets/<attachment-id>.<ext>` (or the older `attachment:<id>`). Images are PNG, JPEG, WebP, or GIF; at most 10 MiB each, 20 per owner, and 50 MiB in total.
- `bindings.json` and `serve.json` are machine-local. `serve.json` tells the CLI where to notify and `wait` where to connect; it never holds a token. `agboard stop` finds the server through it.

  ```json
  {"pid":41235,"port":7420,"started_at":"2026-11-14T03:00:00Z","mode":"auto","idleTimeoutSeconds":1800}
  ```

  `mode` is `auto` for a server a command started and `manual` for `serve` and `serve -d`; a file without it is read as `manual`. `idleTimeoutSeconds` is present only for an automatic server.
- `serve.log` is the output of a server started in the background, by `serve -d` or by a command (owner-only, replaced at every start). An automatic server writes there why it took another port and when it stopped.
- `resident/<tool>.log` (`claude-code.log` or `codex.log`) is the output of the session the board launched for that tool: its standard output and error (owner-only, replaced at every launch). It can hold what the agent printed, so treat it like any other output of an agent running with your account. See [Launching resident sessions](../concepts/agents.md#launching-resident-sessions).
- `autostart.lock` orders commands that start the server at the same time. `autostart.paused` is left by `agboard stop` so that the hook does not start the server again; a command that waits, `serve`, or `serve -d` removes it. See [Server and web UI](../concepts/server-and-ui.md#starting-and-stopping-serve).

`docs/` holds the project's own Markdown documents, which the Docs dialog reads (see [Project docs](#project-docs)).

`project.json` holds `formatVersion`, `id`, `name`, `createdAt`, `nextTaskId`, `nextQuestionId`, and `defaultEpicsSeeded`. `nextQuestionId` is the number of the next question; a file without it is read as `1`. The last one is `true` once the project has been offered the default epics `BUG` and `ENHANCEMENT`; it is written once, so a default epic that was deleted is not created again. A file without it is read as `false`. `epic.json` holds `formatVersion`, `id`, `name`, `color`, `isDraft`, `attachments`, `createdAt`, and `updatedAt`.

`EPIC.md` holds the epic's details in Markdown, frontmatter included. Its frontmatter may hold `priority`, the list of task IDs in work order. The API and `epic show --json` return the whole text as `document`, the text without frontmatter as `body`, and the parsed order as `priority`.

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
  "draft": null,
  "archivedAt": null,
  "requestAnswers": [],
  "createdAt": "2026-10-10T00:00:00Z",
  "updatedAt": "2026-10-10T00:00:00Z",
  "agentStatusChangedAt": "2026-10-10T00:00:00Z",
  "taskStatusChangedAt": "2026-10-10T00:00:00Z",
  "attachments": []
}
```

- `results` is written only when the task has at least one result, so a file from before results existed is unchanged and reads as `results: []`. The format version stays 1.
- Each `requestAnswers` item is `{requestId, actor, choiceId, choiceLabel, text, at}`. `choiceId` and `choiceLabel` are both `null` or both set; `text` is `null` or a valid answer; at least one of choice or text is present.
- `pendingRequestId` and `pendingRequest`, written by earlier versions, are ignored when read and are not written on the next save.
- Older short-request tasks may contain `simpleRequest` metadata. It remains readable for compatibility but new tasks do not write or use it to detect repeats.

In `TASK.md`, `history` is required (`history: []` is valid). New-task input may omit it or pass an empty list; non-empty history in creation input is rejected. Body and acceptance edits keep the latest history, and `edit --desc-file` never appends. `edit --desc-file` also keeps the stored `questions` refs and ignores `history` and `questions` in its input. A direct append may add only `at`/`reason` entries while keeping everything else; the CLI is preferred because it handles time and atomicity.

```yaml
---
acceptance: []
questions: [Q-12]
history:
  - at: "2026-10-15T01:30:00Z"
    reason: "Verified the setup guide links and recorded the result in the task body."
---
```

### Results {#results}

A result is something the requester can look at, delivered by an agent with `agboard result add` (see [Deliver a result](../../guide/reference/cli.md#deliver-a-result)). Results are stored in `task.json` rather than in `TASK.md`, because they are structured data a client reads by version; history stays the only time-ordered text in `TASK.md`. Each entry of `results` has:

| Field | Meaning |
| --- | --- |
| `version` | A positive integer that starts at 1 for each task and grows by one. It never changes or repeats, so a task, a result, and its version name one delivery. |
| `key` | Identifies the delivery for retries: the `--key` the agent gave (1 to 64 characters of letters, digits, `.`, `_`, `:`, `-`), or by default 32 hex digits derived from the kind, summary, link, and image bytes. A key is unique within the task. |
| `kind` | `progress` for an intermediate result, or `final`. |
| `summary` | 1 to 2,000 characters of text. |
| `attachmentId` | Optional. The ID of an image in the task's `attachments`; the file is read from the attachment route. The image cannot be deleted while a result uses it. |
| `link` | Optional. A URL or a storage location of the main artifact, 1 to 2,000 characters on one line. It is stored as given; Agent Board never opens it. |
| `at` | UTC time the result was recorded. |

Recording a result changes neither `taskStatus` nor `agentStatus`. Under one project lock it writes the image (if any), then saves `task.json` and `TASK.md` together with one history entry. If the save fails, the image file is removed and no entry exists, so a failed save is never something to deliver. If the key already exists with the same content, nothing is written and the existing entry is returned. A task holds at most 100 results.

## Messages

A question from an agent to a person and a request from a person to an agent are both stored as one file, `qa/Q-<n>/QA.md`: YAML frontmatter, then the Markdown text as the body. Images sent with a request are kept in `qa/Q-<n>/attachments/`. Questions and requests share one number sequence, taken from `nextQuestionId` in `project.json`, so `Q-<n>` is unique in the project whichever kind it is. The folder name is the ID.

A question:

```markdown
---
from: ai
to: human
tasks: [12]
choices:
  - { id: delete, label: Delete them }
  - { id: keep, label: Keep them }
recommended: keep
askedBy: resident-3f9a1c0e5b7d2a46
reply:
  choice: keep
  via: ui
  at: 2026-11-14T02:41:10Z
  acceptedAt: 2026-11-14T02:50:00Z
createdAt: 2026-11-14T02:30:00Z
---
Should existing records be deleted or kept?
```

A request:

```markdown
---
from: human
to: ai
acceptedAt: 2026-11-14T03:10:00Z
createdAt: 2026-11-14T03:00:00Z
---
Add a dark theme to the settings screen.
```

`from` decides the kind: `ai` is a question (`to: human`), `human` is a request (`to: ai`). Unknown frontmatter keys are refused.

| Field | Rule |
| --- | --- |
| `from`, `to` | `ai` and `human` for a question; `human` and `ai` for a request. |
| body | The text. A question is 1 to 5,000 characters; a request is 1 to 20,000 characters. |
| `createdAt` | When the message was created. |
| `withdrawnAt` | `null` or when it was withdrawn. A message with a reply or an acceptance is not withdrawn. |

Fields of a question:

| Field | Rule |
| --- | --- |
| `tasks` | Optional. The task numbers the question was asked for. It is kept in step with those tasks' `questions` by `message link` and `message unlink`. |
| `choices` | Optional. 2 to 10 items with an ID unique in the question (1 to 64 characters of `[A-Za-z0-9_-]`) and a label of 1 to 200 characters. Without choices, the question is answered with text. |
| `recommended` | Optional. One choice ID. |
| `askedBy` | Optional. The launch ID (`AGBOARD_RESIDENT_ID`) of the board-launched session that asked the question; `message ask` writes it when the variable is set. The board uses it to push the answer back to that session. A question an external session asks has none. |
| `reply` | `null` until answered. `choice` is never set when the question has no choices, and with choices at least one of `choice` and `text` is set; `text` is 1 to 2,000 characters and required when there are no choices; `via` is `ui`, `chat`, or `cli`; `at` is when it was recorded. `acceptedAt` is optional: absent or `null` until an agent takes the answer in, then when it did. |

Fields of a request:

| Field | Rule |
| --- | --- |
| `acceptedAt` | `null` until an agent accepts it, then when it was accepted. |

The state is not stored. A message is withdrawn when `withdrawnAt` is set, closed when its question has a `reply` or its request is accepted, and open otherwise. The CLI and API report a question's status as `open`, `answered`, or `withdrawn`, and a request's as `open`, `accepted`, or `withdrawn`; the filter words shared by both are `open`, `closed`, and `withdrawn`.

A reply is written once, by a person, and an acceptance once, by an agent. That holds for a request's `acceptedAt` and for a reply's `acceptedAt` alike. An answer a person gave in the chat and an agent recorded for them (`via: chat`) is written already accepted. Nothing is written after a withdrawal. The tasks that refer to a question (`referencedBy`) are found from the tasks' `questions`, not from this file.

A `QA.md` that cannot be read, breaks a rule above, or is in a folder not named `Q-<n>` is left out of every list and reported in `problems` as `projects/<id>/qa/Q-<n>/QA.md`; writes to it fail with `file_invalid`. A task that refers to a question whose file cannot be read stays Pending.

Back up a project by copying `shared/projects/<project-id>/`; restore it by stopping `serve` and putting the folder back. There are no export or import commands. See the [data guide](../../guide/operations/data.md).

## Monitor connection settings

The ngrok remote connection keeps its non-secret settings in `<data-root>/.internal/monitor-connection.json`. The file belongs to the application: it is written by the PC settings screen, by `serve`, and by [`agboard setup remote`](../../guide/reference/cli.md#save-the-remote-access-settings), not by hand, and it is not part of the shared area, so it is not backed up with a project. It is replaced atomically with owner-only permissions (`0600` where the OS has them).

```json
{
  "formatVersion": 1,
  "revision": 3,
  "enabled": true,
  "domain": "example.ngrok-free.dev"
}
```

| Field | Rule |
| --- | --- |
| `formatVersion` | Always `1`. Any other value, an unknown field, or a malformed file makes the settings unreadable (`config_unreadable`); the PC entrance keeps working and saving new settings replaces the file. |
| `revision` | Increases with each save, including a save from the command line that only changes the token. The settings API uses it to detect a change made on another screen, and a running server uses it to notice a change made by the command line. |
| `enabled` | Whether the connection starts again with the next `serve`. A stop saves `false`. |
| `domain` | Optional. The ngrok domain the endpoint is requested on, a bare lower-case host name, so the public address is the same at every start. Left out when none is saved. A saved value that is not a bare host name is ignored when read. `AGBOARD_NGROK_DOMAIN`, when set, is used instead of it and is never written to the file. |

The file never holds the ngrok token, the phone passcode, a session, or a CSRF token. A token the user chooses to save lives in the PC's secure storage (the OS credential store) instead (service `agent-board`, account `ngrok-authtoken`). There is no `monitor/config.json`.


## Registered devices

The phones and browsers that entered the passcode keep their registration in `<data-root>/.internal/remote-devices.json`. Like the settings file it belongs to the application: it is written only by the entrance and the PC dialog, replaced atomically with owner-only permissions, and not part of the shared area. It stays across a pause, a restart, and an update.

```json
{
  "formatVersion": 1,
  "devices": [
    {
      "id": "dev_0123456789abcdef",
      "tokenHash": "<SHA-256 of the device token, hex>",
      "label": "iPhone / Safari",
      "origin": "https://example.ngrok-free.dev",
      "createdAt": "2026-11-19T09:00:00Z",
      "lastSeenAt": "2026-11-20T08:30:00Z"
    }
  ]
}
```

- `tokenHash` is the only trace of the device token; the token itself is in the phone's cookie and nowhere else. `origin` is the public address the device was registered for; a cookie presented at another address does not match.
- `label` is a short name from the browser's `User-Agent`, only to tell devices apart. `lastSeenAt` is updated when the device comes back without a session.
- A file that cannot be read, or has another `formatVersion`, is treated as an empty list: no device is accepted until it is registered again, and the next change writes a new file. At most 32 devices are kept.

## Web Push subscriptions

The Web Push subscription of each registered device is kept in `<data-root>/.internal/push-subscriptions.json`, and the VAPID key pair that identifies this board to push services in `<data-root>/.internal/vapid-key.json`. Both belong to the application: written only by the entrance and the PC's device removal, replaced atomically with owner-only permissions, and not part of the shared area. They stay across a pause, a restart, and an update.

```json
{
  "formatVersion": 1,
  "subscriptions": [
    {
      "deviceId": "dev_0123456789abcdef",
      "endpoint": "https://web.push.apple.com/...",
      "p256dh": "<unpadded base64url, 65 bytes>",
      "auth": "<unpadded base64url, 16 bytes>",
      "createdAt": "2026-11-19T01:00:00Z"
    }
  ]
}
```

`vapid-key.json` is `{"formatVersion": 1, "pkcs8": "<base64url PKCS#8 private key>"}`; the private key is never sent anywhere except as a signature. There is one subscription per device id. An unreadable subscription file is treated as empty, and a lost key file is replaced by a new key pair, which drops the subscriptions made for the old one.

## Push delivery ledger

What was sent to which device is kept in `<data-root>/.internal/push-ledger.json`, so a restart, or a second read of the same board data, never sends the same notification twice. Like the other internal files it is written only by the server, replaced atomically with owner-only permissions, and not part of the shared area.

```json
{
  "formatVersion": 1,
  "entries": [
    {
      "deviceId": "dev_0123456789abcdef",
      "key": "result:2:0123456789abcdef0123456789abcdef:12",
      "state": "sent",
      "attempts": 1,
      "at": "2026-11-20T08:30:00Z",
      "retryAt": null
    }
  ]
}
```

- `key` names one occurrence on the board: `result:<version>:<project>:<task>`, `question:<id>:…`, or `history:<n>:…`. It is also the notification's `tag`.
- `state` is `sent`, `pending` (the push service did not take it; `retryAt` says when to try again, and `payload` holds the title, body, link path and tag to send again), `skipped` (the remote connection was down), or `dropped` (refused, or given up after five tries).
- A file written by an older version may still hold `periodicAt` and entries with the keys `periodic:<unix seconds>` or `state:<…>`. The field is read and dropped, and the next save leaves it out; the entries age out like the others.
- Finished entries are kept for 14 days and at most 2000. A file that cannot be read is an empty ledger, and a save that fails is ignored; the board never waits for it. Removing a device removes its entries.

## Phone notification settings

Which notifications the phone receives are saved in `<data-root>/.internal/notification-settings.json`. Like the preferences file, it belongs to the application: it is written only by `PUT /api/notification-settings`, is not in `shared/`, and is replaced atomically with owner-only permissions (`0600` where the OS has them).

```json
{
  "formatVersion": 1,
  "revision": 4,
  "kinds": { "results": true, "questions": true, "history": false }
}
```

| Field | Rule |
| --- | --- |
| `formatVersion` | Always `1`. Any other value, an unknown field, a missing field, or a malformed file is read as the defaults, and the next save replaces the file. |
| `revision` | `0` when nothing is saved, and goes up by one with each save. |
| `kinds` | Three switches for the milestone notifications: `results` (a result was recorded, intermediate or final), `questions` (a decision request is waiting), and `history` (a history entry was added). The defaults are `results` and `questions` on, `history` off. All three off is allowed. |

A file written by an older version may also hold `kinds.stateChanges`, a `stateChanges` group, and a `periodic` group, from the removed card state change and periodic status notifications. They are read and dropped, and the next save leaves them out; they do not make the file invalid.

A save sends the `kinds` group with all of its fields. The last save wins, and there is no conflict check. The file holds no secret.

The code that sends the notifications reads the saved value with `NotificationSettingsStore::load()` in `src/server/notification_settings/`, which returns the defaults when the file cannot be used. The module's `Default` is the single definition of the defaults. A save does not announce itself on the events stream: the settings dialog reads the value each time it opens.

## Display preferences

The saved language and color theme live in `<data-root>/.internal/preferences.json`. The file belongs to the application: it is written only by `PUT /api/preferences`, from the PC or through the ngrok entrance, never by hand. It is not in `shared/`, so a project backup does not include it. It is replaced atomically with owner-only permissions (`0600` where the OS has them), and a failed write leaves the old file as it was.

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

The progress table reads the file too: `agboard progress --json` and the hook add `locale` to the table when the saved language is not English, so an agent keeps replying in the user's language (see [Hook, progress, and wait output](./agent-output.md#progress-table)). Like the README language, this is a read of the file alone; the server need not run, and a missing or invalid file simply leaves the field out.

A save changes only the fields it sends; the others keep their saved values. The last save wins, and there is no conflict check. The preferences hold no secret, and the file never holds a token, a passcode, or a session.

## Session auto-start

The session the board launches when the server starts is saved in `<data-root>/.internal/resident-autostart.json`. The board launches one session in total, so there is at most one choice. The file belongs to the application: it is written only by `PUT /api/projects/{projectId}/sessions/autostart` on the local listener, never by hand. It is not in `shared/`. It is replaced atomically with owner-only permissions (`0600` where the OS has them).

```json
{
  "formatVersion": 2,
  "autoStart": { "tool": "claude-code", "projectId": "0123456789abcdef0123456789abcdef", "model": "sonnet" }
}
```

| Field | Rule |
| --- | --- |
| `formatVersion` | Always `2`. Any other value (including the earlier per-tool format `1`), an unknown field, or a malformed file reads as nothing to start. |
| `autoStart` | The choice, or `null` for none. |
| `autoStart.tool` | `claude-code` or `codex`. |
| `autoStart.projectId` | The project whose bound folder the session starts in. |
| `autoStart.model` | A model name, or `null` for the tool's own default. |

The file holds no secret. A project that no longer exists, or has no bound folder, is not removed from the file: the start shows as `failed` with the reason, and the choice stays until it is turned off.

## Task JSON and snapshots

The CLI, web API, and hook share one camelCase task representation: the `task.json` metadata (including `results`, always present as an array) plus `history`, `description`, `body`, `acceptance`, `acceptanceError`, the displayed `updatedAt`, and `epic` (`{id, name, color}` or `null`). The derived fields are `agentStatus`; `questionIds` (the task's `questions`), `questionsError` (whether that frontmatter is invalid), and `openQuestionIds`; and `pendingRequestId`, `pendingReason`, and `pendingChoices`, taken from the open question with the smallest ID while the task shows `pending` (otherwise `null` and empty). `pendingRequestId` holds that question's ID, such as `Q-12`, which is what the board sends when it answers. `requestAnswers` never appears in history.

- A snapshot returns `project`, `version`, `cursor`, `epics`, `tasks` (each with full history), and `problems` from a single read. The CLI snapshot also includes `nextTaskId`; CLI snapshots, the hook, and `wait` include `fetchedAt`.
- The project list returns `projects` (id, name, createdAt) and `catalogVersion`, without tasks.
- `ls --all-projects --json` returns `catalogVersion` and one snapshot per project, sorted by name, each with its own cursor.

`problems` report format defects: `[{ "file": "projects/<id>/tasks/12/TASK.md", "field": "acceptance[1].text", "reason": "The text must not be empty." }]`. `field` is `frontmatter`, `acceptance[<index>].<key>`, `questions`, `history`, or `history[<index>].<key>` for a task file, or the field of a `QA.md`; `file` is relative to `shared/`; `reason` is English. How defects affect reads and writes is described in [Storage and consistency](../concepts/saving-and-recovery.md#when-files-are-invalid).

## First-run guide

- `shared/.internal/onboarding.json`: `{ "formatVersion": 2, "status": "unseen" | "completed" | "skipped" }`. Version 1 files from earlier releases are read as `completed`, `skipped`, or `unseen` and rewritten once. See [saving and recovery](../concepts/saving-and-recovery.md).
- `tasks/<id>/task.json` `onboardingSample`: `{ "runId": "<32 lowercase hex>", "ordinal": 1 | 2 }`. Written only by earlier releases, on their guide's sample cards. Nothing writes it now; it is still read and kept as it is.

## Files that setup writes {#agent-settings}

`agboard setup` keeps no record of its own. Each agent's plugin list says what is installed, and these files outside the data area are the only ones it changes:

| File | Change |
| --- | --- |
| `$CODEX_HOME/config.toml` (normally `~/.codex/config.toml`) | The data folder is added to `sandbox_workspace_write.writable_roots`, only with `workspace-write` and no permission profile. |
| `$CODEX_HOME/rules/agboard.rules` | Created with `prefix_rule(pattern=["agboard"], decision="allow")` when it does not exist. Not written under full access. |
| `$CLAUDE_CONFIG_DIR/settings.json` (normally `~/.claude/settings.json`) | The data folder is added to `permissions.additionalDirectories`. |

- Each changed file is first backed up next to itself as `<file>.agboard-backup…`, with the original file's access rights. A new file is created owner-only.
- Codex's hook trust is stored by Codex itself, under `hooks.state` in its configuration, through `codex app-server`.
- The installed plugin lives where each agent keeps its plugins; agboard does not write there.
- `agboard update` changes none of these files.

## Folder bindings

A folder binding maps a real folder to a ProjectId so the hook and `agboard progress` know which project a working folder belongs to. It is stored only in the machine-local data area, never in the shared area or tracked files. Because it stores the ProjectId, it follows renames and never moves to a re-created project with the same name. The nearest bound ancestor folder wins. Missing folders, broken bindings, and deleted ProjectIds are explained errors.

## Project docs

`shared/projects/<project-id>/docs/` is the project's document folder. It belongs to the user, not to the board: its files have no format, no `formatVersion`, and no fields, and Agent Board never validates them.

- **Created with the project.** `project create`, and `init` when it creates the project, build `docs/` inside the new project's temporary folder, with a `README.md`, before the folder is renamed into place. The README is English or Japanese, following the app's language in `.internal/preferences.json` (`ja` gives Japanese; anything else, English). Its text is in `src/docs/templates/`.
- **Filled in at startup.** `serve` creates `docs/` and its README for every project that has no `docs/` folder. A folder that exists is left alone, so a README the user deleted stays deleted. A failure here is skipped, because a missing folder reads as an empty tree.
- **Deleted with the project.** `project rm` removes the whole project folder, `docs/` included. Nothing is kept aside. `init` on an existing project resets only `tasks/` and `epics/`, so `docs/` stays.
- **Not board data.** The watcher ignores everything under `docs/`, and the files are not part of the project's `version` (see [Change notifications](../concepts/notifications.md)). Editing them never sends `changed`.
- **Read only through the Docs routes.** The tree lists folders and files; the file route reads `.md` and `.mdx` files of at most 2 MiB in UTF-8; the image route serves PNG, JPEG, WebP, GIF, AVIF, and SVG up to 10 MiB. No route writes a file; people edit the files in their own editor, which **Open in editor** starts for them. See [Web API](./web-api.md#project-docs).
- **Served as stored.** A file read returns the bytes on disk, with no change to line endings, a BOM, the final newline, or the front matter. Its `revision` is `sha256:` and the hex SHA-256 of those bytes.
