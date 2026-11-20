# Web API

The HTTP API of `agboard serve`. How a request is handled, including the write guard, is described in [Server and web UI](../concepts/server-and-ui.md).

Task writes accept optional `X-Agboard-Language: en` or `ja` for generated history. The board sends its current UI language. Missing, repeated, or unsupported values fall back to the task body’s language. This affects only generated text for that request; explicit reasons and stored history stay unchanged. See [History](../concepts/history-and-decisions.md#history).

## Through the ngrok entrance

The ngrok entrance serves the board page and the routes below under the same paths, behind a passcode session instead of the local Host, Origin, and token checks. The page there holds no token. A change sends the session's CSRF token in `X-Agboard-Csrf`, and the session is opened with `/api/remote/session` and `/api/remote/unlock`. See [Entrance routes](./remote-routes.md#the-board-app-through-the-entrance) for those two routes and for what the entrance does not serve (the connection settings, `POST /api/notify`, and `docs/open`).

## Endpoints

| API | Contract |
| --- | --- |
| `GET /` | HTML with the write token in `meta[name=agboard-token]`. |
| `GET /api/projects` | `projects` (id, name, createdAt) and `catalogVersion`, without tasks. 200 even when empty. |
| `POST /api/projects/{projectId}/tasks` | Creates a Todo/Idle task from title, body, acceptance, assignee, and optionally `draft: "human"` (an AI draft is only created by an agent, so `"ai"` is 422 `invalid_value`). The server composes and validates the frontmatter. 201. |
| `POST /api/projects/{projectId}/tasks/multipart` | Creates a regular task with images, or an AI task from a short request with its optional epic and images, in one multipart submission. See below. |
| `PATCH /api/projects/{projectId}/tasks/{id}` | Updates title, body, acceptance, and optional `finalize: true` on a **draft** task. `draft: "ai"` leaves the task an AI draft after the save, so a person's edit of an AI proposal goes back to the proposal; `finalize` on an AI draft is 409 `ai_draft_needs_start`. Body alone keeps the frontmatter; acceptance alone keeps the body; `description` with `body` is 422 `invalid_value`. Last write wins. Non-draft is 409 `task_not_draft`. |
| `PUT /api/projects/{projectId}/tasks/{id}/draft` | Sets `draft` (required): `"human"` makes the task a person's draft, `null` finalizes it, and `"ai"` gives it back to the AI draft it was. An AI draft is cleared only by starting it (`agboard start`): `null` on it is 409 `ai_draft_needs_start`, and `"ai"` on a normal task is 422. With `discard: true` (only together with `null`) the draft is taken back without finalizing, and the history records `Discarded draft changes.`. A running task is 409 `invalid_state_for_draft`. |
| `PUT /api/projects/{projectId}/tasks/{id}/acceptance/{condition}` | `{"done": true\|false}` sets one condition as a person, with no version: the latest `TASK.md` is changed under the lock and the choice wins. Answers `{task, changed}`. An archived task is 409 `task_archived`; an unknown condition is 422 `invalid_argument`. |
| `PUT /api/projects/{projectId}/tasks/{id}/epic` | `{epicId: string \| null}`. Unknown EPIC-ID is 404 `epic_not_found`. |
| `POST /api/projects/{projectId}/tasks/{id}/move` | `taskStatus`, optional `reason`, and optional `fromStatus`, the status the page showed when the user chose the move. With `fromStatus`, a task that is no longer in that status is 409 `task_status_changed` and nothing is written; the body adds `currentStatus`, the status the task has now, so the page can show it and the user can move again from there. The board's move dialog always sends `fromStatus`. |
| `POST /api/projects/{projectId}/tasks/{id}/agent-status` | Changes the run state within the state rules. The UI has no entry point for it. |
| `GET /api/projects/{projectId}/messages` | Questions and requests together, as `{messages}`, newest first. `status` is `open` (the default), `closed`, `withdrawn`, or `all`; `type` is `question` or `request`; `limit` is 1 to 500 (default 50). |
| `GET /api/projects/{projectId}/messages/{messageId}` | One message, as `{question}` or `{request}`. A question has `id`, `type`, `from`, `to`, `body`, `tasks`, `choices`, `recommendedChoiceId`, `reply` (`choiceId`, `choiceLabel`, `text`, `via`, `at`, `acceptedAt`, or `null`; `acceptedAt` is `null` until an agent takes the answer in), `status` (`open`, `answered`, `withdrawn`), `referencedBy`, `createdAt`, and `withdrawnAt`. A request has `id`, `type`, `from`, `to`, `body`, `status` (`open`, `accepted`, `withdrawn`), `acceptedAt`, `withdrawnAt`, and `createdAt`. An unknown ID is 404 `message_not_found`. |
| `POST /api/projects/{projectId}/messages/answers` | `{answers: [{questionId, choiceId?, text?}]}`, with unknown fields refused. A question with choices needs a `choiceId`, a `text`, or both (a `text` alone is a valid answer with a `null` choice); one without needs a `text`. An unknown choice is 422 `choice_unknown`, and a request ID is 422 `message_type_mismatch`. All answers are saved together or none. When a question already has an answer or was withdrawn, nothing is saved and the response is 409 with `error`, `questionAnswered` and `questionWithdrawn` (the IDs), and `questions` (the recorded questions). An unknown question is 404 `message_not_found`. Returns `{questions}`. |
| `POST /api/projects/{projectId}/messages/requests` | Sends a request to an agent. A multipart body with a `text` part and any number of `images` file parts. Returns 201 `{request}`. |
| `GET /api/projects/{projectId}/messages/{messageId}/attachments/{name}` | An image sent with a request. A request body refers to its images as `![alt](attachments/<name>)`; `<name>` is the file name. Returns the image with its type taken from the file (PNG, JPEG, WebP, or GIF), `Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`. A name that is not a plain file name (a path, `..`, a leading dot), a file that is not there, a file that is not an image, and a symbolic link are 404 `attachment_not_found`; an unknown message is 404 `message_not_found`. Read-only; it is also served through the entrance. |
| `POST /api/projects/{projectId}/messages/{messageId}/withdraw` | A person withdraws a request and gets `{request}`. A question is 403 `ai_only`; a request that was accepted is 409 `message_closed`, and one already withdrawn is 409 `request_withdrawn`. Accepting a request or an answer has no endpoint: only the CLI does it. |
| `DELETE /api/projects/{projectId}/tasks/{id}` | Deletes archived tasks only; others are 409 `task_not_archived`. 204, or 404 when already gone. |
| `GET …/tasks/{id}/results` | The task's results, oldest first: `{taskId, results}`; each result has the fields in [Results](./files.md#results). Read-only; an unknown task is 404 `task_not_found`. Results are also in the `results` array of every task object the API returns. The Summary and Detail streams do not carry them. |
| `…/tasks/{id}/attachments`, `…/attachments/{attachmentId}` | Task images (GET, POST, DELETE), matched by ProjectId, task ID, and attachment ID. |
| `GET`/`POST /api/projects/{projectId}/epics` | List and create epics (id, name, color, draft, document or body). No `acceptance` input. 201. |
| `GET`/`PATCH`/`DELETE /api/projects/{projectId}/epics/{epicId}` | Read, or update name, color, draft, document or body, and priority. Keeps the body and unknown metadata. The update does not refuse a draft epic; the CLI does (`epic_is_draft`). `draft: null` releases a person's draft (an AI draft epic is 409 `ai_draft_needs_start`), and nothing is recorded because an epic has no history. Saves `EPIC.md` before `epic.json`. `DELETE` answers 204; it is refused with 409 `epic_in_use` while any task, archived ones included, names the epic. |
| `…/epics/{epicId}/attachments`, `…/{attachmentId}` | Epic images. |
| `POST …/tasks/{id}/archive`, `POST …/tasks/{id}/restore` | No body. Repeating either on a task already in that state returns the same task unchanged. |
| `POST …/tasks/archive-done` | `{ids: number[]}`; empty, duplicate, or invalid IDs are 422. Returns `{tasks, archivedCount}`. |
| `GET /api/projects/{projectId}/archive` | Archived tasks with bodies, full history, and attachment metadata, plus `epics` from the same snapshot. Each task's `epicId` resolves against that list; a task without an epic, or one whose epic is missing, has no label. |
| `GET /api/projects/{projectId}/summary` | The list data for the board: project, `version`, tasks, epics, and problems, without any body text. See [Summary and Detail](#summary-and-detail). |
| `GET /api/projects/{projectId}/sessions` | The agent sessions attached to the project and their counts, plus the sessions the board launched. See [Attached sessions](#attached-sessions). Never cached. |
| `GET …/sessions/models`, `POST …/sessions/launch`, `POST …/sessions/stop` | Launch and stop headless Claude Code and Codex sessions. Local listener only. See [Launching sessions](#launching-sessions). |
| `GET /api/projects/{projectId}/tasks/{id}/detail` | One task's body, acceptance conditions, and history as an NDJSON stream. Archived tasks are read the same way. |
| `GET /api/projects/{projectId}/epics/{epicId}/detail` | One epic's document as an NDJSON stream. |
| `GET /api/projects/{projectId}/docs/tree`<br>`GET /api/projects/{projectId}/docs/file`<br>`GET /api/projects/{projectId}/docs/assets`<br>`POST /api/projects/{projectId}/docs/open` | The project's documents in `docs/`, read-only: the folder tree, one Markdown or MDX file, an image, and opening the folder or a file in the computer's own app. See [Project docs](#project-docs). |
| `GET /assets/{name}` | Only the content-named scripts and stylesheets listed in the table generated by `build.rs`; others are 404. Immutable caching, gzip when `Accept-Encoding` allows it, `Vary: Accept-Encoding`. |
| `GET /docs-sandbox`<br>`GET /docs-sandbox/{name}` | The page that runs a document's MDX, and its content-named script (any other name is 404). A fixed page with no token and no board data. It has its own `Content-Security-Policy`: `default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`, and `X-Content-Type-Options: nosniff`. The board embeds it in an iframe with `sandbox="allow-scripts"`. See [MDX in the Docs](../concepts/security.md#mdx-in-the-docs). |
| `GET /api/events` | SSE: `ready` after subscribing with the board's build ID (`{"build":"<16 hex>"}`), `changed` with the changed resources (see [Change events](#change-events)), `preferences` after a saved language or theme change (the same JSON as `GET /api/preferences`), a keep-alive comment every 15 seconds. |
| `GET /api/preferences` | The saved language and color theme: `locale`, `theme` (`mode`, `accent`), and `revision`. A missing or unreadable file gives the defaults. Never cached. See [Display preferences](#display-preferences). |
| `PUT /api/preferences` | Saves the `locale`, `theme`, or both, from the JSON body, and returns the same shape as `GET` with `revision` raised by one. Unknown fields and invalid values are 422 `invalid_preferences`; a failed write is 500 `preferences_unavailable`. A refused or failed save leaves the saved value unchanged. |
| `GET /api/notification-settings` | Which notifications the phone receives: `kinds` and `revision`. A missing or unreadable file gives the defaults. Never cached. See [Phone notification settings](#phone-notification-settings). |
| `PUT /api/notification-settings` | Saves the `kinds` group from the JSON body, and returns the same shape as `GET` with `revision` raised by one. Invalid bodies are 422 `invalid_notification_settings`; a failed write is 500 `notification_settings_unavailable`. |
| `POST /api/notify` | Asks every client to re-fetch. Changes no data and needs no token. 204. |
| `GET /api/health` | `ok` and `pid`. |
| `GET /api/monitor-connections` and the routes under it | The ngrok remote connection. See [Remote connection](#remote-connection). |

### Summary and Detail

The board reads a project in two steps. The Summary lists everything a card or a list row shows. The Detail streams what is read only when a card or an epic opens. The same routes are served through the ngrok entrance behind the passcode session; see [Entrance routes](./remote-routes.md). A project ID in the path selects what is read. It is not an access right.

The shapes below are fixed by the Rust types in `src/server/contracts/` and by the golden examples in `tests/fixtures/data-layer/`, which the Rust and TypeScript tests both read.

**Summary.** `GET …/summary` returns `project` (`id`, `name`), `version`, `tasks`, `epics`, `questions`, `messages`, and `problems`. The response never holds a body, acceptance text, history, epic document, or image bytes. It is built from the projection in the index, so no file is read for it. Archived tasks are not listed (the epics count them). `version` is a hash of the parsed data and is also the `ETag` (`"<version>"`); a request whose `If-None-Match` names it (a list, a weak tag, or `*` also match) gets `304` with no body. A missing project is 404 `project_not_found`, a malformed ID is 422 `invalid_value`, and a project whose `project.json` cannot be read gets that file's error.

| Item | Fields |
| --- | --- |
| Task | `id` (integer), `title`, `taskStatus`, `agentStatus`, `assignee`, `draft`, `position`, `epicId` (or `null`), `acceptance` (`done`, `total`), `acceptanceError`, `createdAt`, `updatedAt`, `taskStatusChangedAt`, `agentStatusChangedAt`, `questionIds`, `openQuestionIds`, `pendingRequestId`, `pendingReason`, `pendingChoices`, `onboardingSample` (only on cards written by earlier releases' guide), and `detailVersions` (`document`, `history`). The names match the board's `Task`. |
| Epic | `id` (string), `name`, `color`, `draft`, `priority` (the task IDs in the order the epic sets; empty when it sets none), `priorityError` (the stored order cannot be read, so `priority` is ignored), `progress` (`todo`, `doing`, `done`, `archived`, `total`), and `detailVersions` (`document`). |
| Question | The open questions in ID order: `id`, `title` (the first line, up to 200 characters), `recommendedChoiceId`, `referencedBy` (the unarchived tasks that refer to it), and `createdAt`. The full text is read with `GET …/messages/{messageId}`. |
| Message | The open questions and requests in one shape, oldest first (ties by ID): `id` (`Q-<n>`), `type` (`question` or `request`), `from`, `to` (`ai` or `human`), `turn` (who has to act: `ai`, `human`, or `null` for one that is over), `title`, `createdAt`, `tasks` (the task numbers it concerns; a request has none), and `epicId` (or `null`). A question's turn is `human` while it is open and `ai` once it is answered but no agent has accepted the answer; an answered question stays listed until then. A request's turn is `ai`. A question whose answer was accepted, an accepted request, and a withdrawn message are left out, so a listed message always has a `turn`. `questions` stays for the screens that still read it. |
| Problem | `file`, `field`, `reason`, as in the board. |

Every version is an opaque string: a content hash of the parsed data. It does not depend on the server run, so a cached value can be compared after a restart. Compare versions for equality only.

**Detail.** `GET …/tasks/{id}/detail` and `GET …/epics/{epicId}/detail` answer `200` with `Content-Type: application/x-ndjson` and `Cache-Control: no-store`. Each line is one JSON object whose `type` names the event:

| `type` | Fields | Meaning |
| --- | --- | --- |
| `start` | `resource` (`task` or `epic`), `id`, `projectId`, `sections`, `versions` | The first line. `versions` names exactly the requested sections. |
| `section-start` | `section` (`document` or `history`) | Opens a section. |
| `attachments` | `items` | The resource's attachments. Sent once in the `document` section, right after `section-start` and before the first block. Not counted in `section-end`'s `count`. |
| `block` | `kind` (`markdown` or `mermaid`), `text`, optional `images` | A top-level Markdown block of the document. Joining the blocks gives the body. Each image has `src` (the URL used in `text`) and, when the file header can be read, `width` and `height`. |
| `acceptance` | `id`, `text`, `done` | One acceptance condition, in full. Tasks only; it follows the blocks. |
| `history-item` | `at`, `reason` | One history entry, oldest first. Tasks only. |
| `section-end` | `section`, `count` | Closes the section. `count` is the number of item lines in it. |
| `complete` | `versions` | The last line. It repeats the `versions` of `start`, both computed from one snapshot. |

The order is `start`, then for each requested section `section-start`, its items, and `section-end`, then `complete`. The `document` section comes before `history`. A task's `document` section holds blocks followed by acceptance conditions; an epic has only a `document` section. A stream that ends without `complete` is incomplete: the client discards what it received.

`?sections=document`, `?sections=history`, or `?sections=document,history` choose the sections; without the parameter both are sent, and an epic has no `history`. Any other value is 400 `invalid_sections`. A missing project, task, or epic is 404 before the stream starts. A failure after the first line sends no `complete` and closes the connection.

#### Change events

`changed` carries the changed resources:

```json
{"instanceId": "inst-5f3a", "seq": 42, "projectId": "…", "changes": [
  {"resource": "task", "id": 302, "facets": ["summary", "request", "history"]},
  {"resource": "epic", "id": "EPIC-1", "facets": ["document"]},
  {"resource": "project", "id": "…", "facets": ["deleted"]}
]}
```

| Field | Meaning |
| --- | --- |
| `instanceId` | One value per server start. A new value tells a client that `seq` began again. |
| `seq` | An integer that grows by one per `changed` within an instance. A gap means an event was missed. |
| `projectId` | The project the changes belong to. The stream carries every project and the page ignores the others. |
| `changes[].resource` | `task`, `epic`, or `project` (the project list changed: created, renamed, deleted). |
| `changes[].id` | An integer for a task, a string for an epic and for a project. |
| `changes[].facets` | A non-empty list without repeats. `summary`: title, status, position, epic, pending question, acceptance counts. `request`: the question the task waits on changed (asked, answered, withdrawn, linked, or unlinked); only for a task, always with `summary`. `document`: the body and acceptance text. `history`: the history. `deleted`: the resource is gone. A project has only `summary` or `deleted`. Moving a task to the archive, or restoring it, is a `summary` change. |

A client that sees a gap in `seq`, a new `instanceId`, or an event it does not know drops the Summary and the related cached details. `ready` and `preferences` are unchanged.

The server compares the parsed data before and after every reload, so a save that changes nothing the Summary or a Detail shows sends no event. A file that cannot be parsed changes every facet of its resource. A stream that fell too far behind gets `resync` (`{"instanceId", "seq"}`, the newest number) instead of the events it missed, and the client fetches everything again.

### Attached sessions

`GET /api/projects/{projectId}/sessions` lists the agent sessions that wait on a project, for the settings screen and the footer. A session is attached while a `wait --until task` command of it holds an `/api/events` stream open. The same route is served through the ngrok entrance behind the passcode session, like the other reads. It carries no paths, process IDs, or environment values. The response also has `launched`; see [Launching sessions](#launching-sessions).

```json
{
  "sessions": [
    {
      "id": "claude:0a1b2c3d4e5f6071",
      "tool": "claude-code",
      "origin": "external",
      "connectedAt": "2026-11-19T01:00:00Z",
      "lastSeenAt": "2026-11-19T01:12:30Z",
      "state": "connected"
    }
  ],
  "counts": {
    "total": 1,
    "connected": 1,
    "byTool": { "claude-code": 1, "codex": 0, "unknown": 0 },
    "byOrigin": { "board": 0, "external": 1 }
  }
}
```

- `tool` is `claude-code`, `codex`, or `unknown`. `origin` is `board` for a session the board launched and `external` for any other.
- `state` is `connected` while a stream is open and `grace` for 30 seconds after the last one closed, so the gap between one wait and the next does not make the count flicker. A session in grace still counts in `total` and the other counts; `connected` counts only open ones. After the grace period the session is gone. `lastSeenAt` is the current time while connected and the time the last stream closed in grace. A session that reconnects within the grace period is the same session and keeps its first `connectedAt`.
- Sessions are ordered by `connectedAt`. A malformed project ID is 422 `invalid_value`; a project with no sessions (or one that does not exist) has an empty list.
- The server keeps the registry in memory only. After a restart it is empty and fills again as the waits reconnect. The list is read on request; the UI polls it, and no event announces a change.

How a stream names its session: a command that waits for tasks sends four headers with its `GET /api/events` request, and a stream without a valid set is simply not counted.

| Header | Value |
| --- | --- |
| `X-Agboard-Session` | The session key: 1 to 64 characters of `A-Z a-z 0-9 . _ : -`. |
| `X-Agboard-Session-Project` | The project's ID. |
| `X-Agboard-Session-Tool` | `claude-code`, `codex`, or `unknown`. |
| `X-Agboard-Session-Origin` | `board` or `external`. |

The limit on launching is held by the launcher: it refuses a launch while it has a live child or a waiting restart, and also when `SessionRegistry::check_board_launch()` finds a board-origin wait of a session it does not know. Board-launched sessions are limited to one in total, over both tools and all projects. The refusal names the tool that holds the slot. External sessions are never limited or counted against the limit. `AGBOARD_SESSION_GRACE_MS` replaces the 30-second grace period with a number of milliseconds; tests use it.

### Launching sessions

These routes start and stop the headless sessions the board launches (see [Launching resident sessions](../concepts/agents.md#launching-resident-sessions)). **A launched session runs unattended with automatic approval**; see [Sessions the board launches](../concepts/security.md#sessions-the-board-launches). The routes exist only on the local listener, like the [remote connection](#remote-connection) routes: the ngrok entrance does not serve them (404), a read must come from the local page, and the two writes pass the browser write guard. A malformed project ID is 422 `invalid_value`.

| API | Contract |
| --- | --- |
| `GET /api/projects/{projectId}/sessions/models?tool=` | `tool` is `claude-code` or `codex` (another value is 422 `invalid_value`). Returns `{"models": [{"id", "label"}], "reason": null}`. When the list cannot be read it is `{"models": [], "reason": "<why>"}`, and a launch without a model uses the tool's default. The command is not installed: 409 `agent_cli_missing`. |
| `POST /api/projects/{projectId}/sessions/launch` | `{"tool": "claude-code" \| "codex", "model"?: string}`. A missing, empty, or `"default"` model leaves the choice to the tool. Starts the session in a bound folder of the project and returns `{"launched": {"tool", "projectId", "model", "startedAt"}}`. A model that is not offered, or that is not a model name: 422 `invalid_value`. An unknown project: 404 `project_not_found`; a project with no existing bound folder: 409 `project_has_no_folder`; the CLI missing or logged out: 409 `agent_cli_missing` or `agent_cli_logged_out`; a session of that tool already launched or attached by the board: 409 `session_launch_refused` with the reason; the process could not be started: 500 `session_launch_failed`. |
| `PUT /api/projects/{projectId}/sessions/autostart` | `{"enabled": boolean, "tool"?: "claude-code" \| "codex", "model"?: string}`. Saves whether a session starts with the server, and which: this tool, in this project, with this model (a missing, empty, or `"default"` model leaves the choice to the tool). There is one choice in total; saving replaces it. `tool` is required when `enabled` is `true` (else 422 `invalid_value`, as for an unknown tool or a model that is a flag). It does not launch anything and does not stop a running session. Returns `{"autoStart": {"tool", "projectId", "model"}}`, or `{"autoStart": null}` when `enabled` is `false`. An unknown project: 404 `project_not_found`; no existing bound folder: 409 `project_has_no_folder`. The stored file is in [Shared files](./files.md#session-auto-start). |
| `POST /api/projects/{projectId}/sessions/stop` | `{}`. Stops the launched session, which is one in total, so the request names no tool (a `tool` in the body is accepted and ignored). Returns `{"stopped": true}` when the call returns, or `{"stopped": false}` when none was running. It also clears a waiting restart or a shown failure. The session no longer counts, so a new launch is possible at once. |

`GET /api/projects/{projectId}/sessions` also carries `launched`, the sessions of that project that the launcher holds a process for, as `[{"tool", "projectId", "model", "startedAt"}]`. It has no process ID. A launched session appears in `sessions` (with `origin: "board"`, and an `id` of `resident:` plus its launch ID) once its driver has reported its first event. It does not wait on the board, so the server adds it to the registry's list and counts: `state` is `connected` while the session is idle between turns and `grace` while it works. External sessions are listed and counted by their waits as before.

#### Session health

`GET /api/projects/{projectId}/sessions` also carries `health`, one object for the single session slot of the board. It belongs to the board, not the project, so `projectId` says which project the session is for. It has no paths or process IDs.

```json
"health": {
  "tool": "claude-code",
  "state": "restarting",
  "projectId": "0123456789abcdef0123456789abcdef",
  "model": "sonnet",
  "reason": "The claude-code session exited (signal: 9 (SIGKILL)).",
  "waiting": false,
  "pushStalled": [],
  "restartCount": 2,
  "lastExitAt": "2026-11-19T03:00:00Z",
  "nextRestartAt": "2026-11-19T03:00:04Z",
  "autoStart": { "tool": "claude-code", "projectId": "0123456789abcdef0123456789abcdef", "model": "sonnet" }
}
```

When nothing is launched, it is `{"tool": null, "state": "stopped", "projectId": null, "model": null, "reason": null, "waiting": false, "pushStalled": [], "restartCount": 0, "lastExitAt": null, "nextRestartAt": null, "autoStart": null}` (with `autoStart` set when a choice is saved).

| Field | Meaning |
| --- | --- |
| `tool` | The tool of the session the board keeps; `null` while `stopped`. |
| `state` | `running`: the board keeps a session running, and its child exists. `restarting`: the child ended and a restart is waiting for `nextRestartAt`. `failed`: the board gave up, or could not start the session, and `reason` says why. `stopped`: nothing is kept running. |
| `projectId`, `model` | What the board relaunches. `null` while `stopped`. |
| `reason` | Why the session is `restarting` or `failed`; `null` otherwise. A crash loop ends in `failed` with a reason that says the board stopped restarting. |
| `waiting` | `true` while the session is attached and idle between two turns, so the board can hand it work. A `running` session with `waiting: false` is working, and is never ended for that. |
| `pushStalled` | Items the board pushed to the session several times without the session handling them, and gave up on, each as `{"kind", "id", "attempts", "lastError"}`: `kind` is `request`, `answer`, or `task`; `id` is the request or question ID such as `Q-3`, or the task number as text; `attempts` is how many times it was pushed; `lastError` is the message of the last failed turn, or `null`. Empty when there are none; an item leaves the list when it leaves the board. See [Push mode](../concepts/agents.md#push-mode). |
| `restartCount` | The restarts since the last launch or stop by a person. |
| `lastExitAt` | When the child last ended without a stop by a person; `null` if it never did. |
| `nextRestartAt` | When the waiting restart starts; `null` unless `restarting`. |
| `autoStart` | The saved auto-start choice, `{"tool", "projectId", "model"}`, or `null`. |

The defaults behind this are in [Launching resident sessions](../concepts/agents.md#launching-resident-sessions). A person's launch from `failed` or `restarting` is accepted and starts over; a stop returns the tool to `stopped`.

### Remote connection

These routes exist only on the local listener (`127.0.0.1`); the ngrok entrance never serves them. A read must come from the local page: a foreign Host, cross-site `Sec-Fetch-Site`, or foreign Origin is 403. The writes pass the same browser write guard as other writes.

| API | Contract |
| --- | --- |
| `GET /api/monitor-connections` | The current state, described below. Never holds a secret. |
| `PUT /api/monitor-connections/settings/ngrok` | Saves `{enabled, revision, domain?}` and returns the state. `revision` must be the one last read. `domain` is optional: left out, the saved domain is kept; an empty string clears it; otherwise it must be a bare host name (no scheme, path, port, or wildcard) and is saved lower-cased, or the answer is 422 `invalid_domain`. Unknown fields are 422 `invalid_value`; a stale revision is 409 `revision_conflict`; a failed save is 500 `save_failed` and changes nothing. Saving while the tunnel runs does not replace it; only a start does. |
| `POST /api/monitor-connections/transports/ngrok/start` | Starts the connection and answers 202 with the state (usually `starting`). The optional body is `{token, save}`. `token` is held in memory only; `save: true` also stores it in the PC's secure storage (the OS credential store) and needs a `token`. A disabled setting is saved as enabled first. A start while the tunnel runs replaces it and makes a new passcode. |
| `POST /api/monitor-connections/transports/ngrok/stop` | Stops the connection, saves it as disabled, and answers 200 with the state. |
| `GET /api/monitor-connections/devices` | The registered devices, the one seen last first: `{"devices":[{"id","label","createdAt","lastSeenAt"}]}`. Never holds a token or its digest. Works while the connection is paused. |
| `DELETE /api/monitor-connections/devices/{id}` | Unregisters a device and answers 200 with the devices that are left. Its live sessions and open event streams end at once. An unknown id is 404 `device_not_found`; if the list cannot be saved nothing changes and the answer is 500 `save_failed`. |
| `DELETE /api/monitor-connections/token` | Removes the token saved in the secure storage and answers 200 with the state. Removing nothing is not an error. |

The state object has these fields:

| Field | Meaning |
| --- | --- |
| `status` | `disabled`, `needs_config`, `starting`, `ready`, `reconnecting`, `failed`, or `stopping`. |
| `url` | The public HTTPS address once `ready`; otherwise `null`. |
| `revision` | The settings revision, for `PUT`. |
| `settings` | `enabled`, and `domain` (the saved ngrok domain, or `null`). |
| `domainEnv` | The domain from `AGBOARD_NGROK_DOMAIN`, or `null`. When it is set, a start uses it instead of `settings.domain`. |
| `tokenConfigured` | Whether a start would find a token. |
| `tokenSource` | `env` (`NGROK_AUTHTOKEN`), `keychain` (the secure storage), `session` (typed for this run), or `null`. Never the value. |
| `keychainAvailable` | Whether this PC has a secure storage (the OS credential store) that can hold a token. |
| `keychainTokenSaved` | Whether a token is saved in the secure storage, even if another source is used. |
| `failure` | `null`, or one of `connect_failed`, `endpoint_failed`, `public_url_invalid`, `internal`, `config_unreadable`, `config_invalid`. |
| `passcode` | The 4-digit passcode of the running connection, for the PC to show. Present only while `status` is `ready`; omitted when the connection is starting, stopped, or failed. It is the one secret this API returns. |

A start reports its progress through this state; poll `GET` until `status` leaves `starting`. The token, the count of wrong guesses, and sessions never appear in any response or in the settings file, and the passcode appears only here (and on the `serve` startup line). The settings are stored as described in [Shared files](./files.md#monitor-connection-settings). The error codes are in [Error codes](./errors.md#remote-connection).

### Display preferences

`GET` and `PUT /api/preferences` are on the local listener, and the ngrok entrance serves the same pair behind the session (see [Entrance routes](./remote-routes.md)). The file behind them is described in [Shared files](./files.md#display-preferences).

`PUT` takes a JSON body with `locale` (`en` or `ja`), `theme` (`{"mode": "light" | "dark", "accent": <one of the 12 accents>}`), or both. A field that is not sent keeps its saved value:

```json
{"locale": "ja", "theme": {"mode": "dark", "accent": "teal"}}
```

A save that succeeds returns the saved preferences and sends a `preferences` event to every open events stream of `/api/events`. The event's data is the same JSON as `GET`. The PC `PUT` passes the same write guard as the other PC writes (Host, Origin, `Sec-Fetch-Site: same-origin`, and `X-Agboard-Token`). Through the ngrok entrance the `PUT` needs the session and the CSRF token, like an answer.

A malformed JSON body is 400, as for other writes. A body with neither field, a field other than `locale` and `theme`, or a value that is not allowed is 422 `invalid_preferences`. There is no revision check: the last save wins.

### Phone notification settings

`GET` and `PUT /api/notification-settings` are on the local listener, and the ngrok entrance serves the same pair behind the session, as for the preferences (see [Entrance routes](./remote-routes.md)). The file behind them is described in [Shared files](./files.md#phone-notification-settings).

`GET` returns the saved settings, or the defaults with `revision` `0`:

```json
{
  "kinds": { "results": true, "questions": true, "history": false },
  "revision": 0
}
```

`PUT` takes a JSON body with `kinds`, which must carry all of its fields (`results`, `questions`, `history`). It returns the same shape as `GET` with `revision` raised by one. The write guards are the same as for `PUT /api/preferences`.

The periodic status notification and the card state change notifications were removed. A page that is still open from an older version may send their old fields: `stateChanges` and `periodic` are accepted and ignored, and `kinds.stateChanges` is accepted and ignored too. A body that carries only those removed fields has nothing to save and is 422. `GET` never returns them.

A malformed JSON body is 400. An empty body, an unknown field, or a missing field is 422 `invalid_notification_settings`; a failed write is 500 `notification_settings_unavailable`. Nothing is saved on a refusal. There is no revision check: the last save wins.

### Project docs

These routes read the files in the project's `docs/` folder (`shared/projects/<projectId>/docs/`); none of them writes it, and a `PUT` to the file route is 405. They are on the board router, which the ngrok entrance serves behind its session, except `POST .../docs/open`, which only the local listener serves. A change to the docs on disk is announced by the SSE `docs` event, never by `changed` (see [Change notifications](../concepts/notifications.md#the-docs)). Paths are relative to `docs/`, use `/`, and are checked as described in [Security model](../concepts/security.md#project-docs). A project ID that is not 32 lowercase hexadecimal digits is 422 `invalid_value`.

| API | Contract |
| --- | --- |
| `GET …/docs/tree` | The folders and files under `docs/`, names only, as `{nodes, truncated}`. A file has `viewer`: `markdown` for `.md` and `.mdx`, `image` for `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.avif`, and `.svg`, and `other` for any other file, which the Docs list but do not show. A folder has no `viewer`. Folders come first, then files, each sorted by name ignoring case. Names that start with a dot, symbolic links, and names the path rules refuse are left out. A missing folder is an empty tree, not an error. At most 5,000 entries and 16 folder levels are listed; `truncated: true` says that a limit cut the listing short. |
| `GET …/docs/file?path=` | `{path, content, revision}`. `content` is the file's exact text, a BOM included. `revision` is `sha256:` and the hex SHA-256 of the file's bytes; the page compares it to tell whether a file changed. Only `.md` and `.mdx` files (any case) of at most 2 MiB that are valid UTF-8 are served. |
| `GET …/docs/assets?path=` | The bytes of a PNG, JPEG, WebP, GIF, AVIF, or SVG image of at most 10 MiB. `Content-Type` comes from the extension (`image/png`, `image/jpeg`, `image/webp`, `image/gif`, `image/avif`, `image/svg+xml`) and the response carries `X-Content-Type-Options: nosniff`. An SVG response also carries `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`, so the file runs no script when its URL is opened on its own; the page shows it in an `<img>`, where script never runs. Every other type is 415 `docs_asset_type`. |
| `POST …/docs/open[?path=]` | No body. On the machine that runs the server, opens the project's `docs/` folder in the file manager, or, with `?path=`, that file in the app the computer uses for its type: `open` on macOS, `explorer` on Windows, and `xdg-open` elsewhere. The path is checked as a read checks it and must name an existing file of any type (400 `docs_path_invalid`, 404 `docs_not_found`). The program is started with the folder or file as its only argument, without a shell, and the route does not wait for it to finish. Answers 204. An unknown project is 404 `project_not_found`. A missing `docs/` folder, or a program that cannot be started (for example, `xdg-open` is not installed), is 500 `docs_open_failed`. It passes the write guard like other writes, because it starts a program. |

A tree:

```json
{"nodes":[{"name":"design","path":"design","kind":"dir","children":[{"name":"images","path":"design/images","kind":"dir","children":[]},{"name":"spec.md","path":"design/spec.md","kind":"file","viewer":"markdown"}]},{"name":"flow.png","path":"flow.png","kind":"file","viewer":"image"},{"name":"app.pen","path":"app.pen","kind":"file","viewer":"other"},{"name":"README.md","path":"README.md","kind":"file","viewer":"markdown"}],"truncated":false}
```

A file:

```json
{"path":"design/spec.md","content":"---\ntitle: Design\n---\n# Design\n","revision":"sha256:b9dc9fdb…"}
```

Failures use the usual error body. Their codes and statuses are in [Error codes](./errors.md#project-docs).

### Multipart task creation

`POST /api/projects/{projectId}/tasks/multipart` accepts exactly one `metadata` part containing JSON and zero or more `file` parts. Each file must have a matching `{id, name}` entry in `metadata.attachments`; normal attachment count, size, and media-type limits apply. For a regular task, metadata includes `requestId`, `title`, `description`, `assignee`, and optionally `draft` (`"human"` on a new task; `"ai"` on an edit leaves the task an AI draft after the save). For the short request form, send:

```json
{
  "requestKind": "simple",
  "description": "First line becomes the title\n\nFull request details",
  "epicId": "DESIGN",
  "attachments": [{"id": "<attachment-id>", "name": "sketch.png"}]
}
```

`epicId` and `attachments` are optional; omit the epic or use `null`, and use an empty attachments array when there are no images. A simple request accepts no `title`, `assignee`, `draft`, or `finalize` metadata. The server creates an AI-owned Todo task, wraps the original text in `## 元の依頼`, and derives the title from the first non-empty line (up to 100 Unicode characters). It validates and stages the task and its images under the project lock, then publishes them together by renaming the completed task directory. Every accepted submission creates a new task and returns `201 {"task": …}`; the server does not compare content to detect duplicates. A task created with its own metadata continues to use `POST /tasks` or the regular multipart metadata; it does not become a simple request.

**Bulk archive.** The target IDs are fixed when the confirmation opens; the request never re-collects all Done tasks. Under the lock every unarchived target must still be Done. If any target moved or was deleted, the whole request is 409 `archive_targets_changed` and nothing changes. Targets that are already archived count as done, so a retry after a lost response never duplicates history. Targets are saved one at a time with a single reload and notification at the end; if a save fails partway, the saved targets stay archived and a retry handles the rest.

**Errors** carry `code`, `message`, and `reason`:

| Status | Meaning |
| --- | --- |
| 400 | Malformed JSON, an invalid `sections` query (`invalid_sections`), or an invalid docs path (`docs_path_invalid`). |
| 403 | A guard failed, or `ai_only` (a person tried to withdraw a question). |
| 404 | Project, task, epic, or message not found, or a docs file not found. |
| 409 | `question_answered`, `question_withdrawn`, `message_closed`, `request_accepted`, `answer_accepted`, `question_open`, `request_withdrawn`, `task_status_changed`, `task_not_draft`, `ai_draft_needs_start`, `invalid_state_for_draft`, `start_blocked_by_questions`, `epic_in_use`, `epic_id_taken`, `task_not_archived`, `archive_targets_changed`. |
| 413 | Body over 1 MiB, or a docs file over its limit (`docs_too_large`). |
| 415 | A docs file that is not Markdown, or an image type the docs do not serve (`docs_not_markdown`, `docs_asset_type`). |
| 422 | Invalid ID syntax, input, or state rule; a docs file that is not UTF-8 (`docs_not_utf8`); or an invalid source file (`file_invalid`) with path, field, and reason. |
| 503 | The lock wait timed out. |
| 500 | Anything else, including `format_unsupported`, `file_unreadable`, and `file_error`. |

## First-run guide

| Method and path | Purpose |
| --- | --- |
| `GET /api/onboarding` | Whether this data area has seen the guide: `{ "formatVersion": 2, "status": "unseen" \| "completed" \| "skipped" }`. Read only. |
| `POST /api/onboarding/seen` | Record how the guide ended: `{ "outcome": "completed" \| "skipped" }`. Returns the same shape as `GET`. A later call replaces the earlier outcome. |

The write passes the write guard, and a body with an unknown field, a missing `outcome`, or any other value is refused with `invalid_value` (422). Both routes are on the board router, so the ngrok entrance serves them behind its session like the other board routes. The guide itself runs in the web UI; the server stores only this status. See [saving and recovery](../concepts/saving-and-recovery.md#the-first-run-guides-state).
