# Hook, progress, and wait output

The JSON that agents receive. The pieces are explained in [Agent integration](../concepts/agents.md). Task and epic fields are described in [Shared files](./files.md#task-json-and-snapshots).

## Progress table

`agboard progress --json` and the hook return the same table:

```json
{
  "fetchedAt": "2026-10-17T00:48:47Z",
  "project": { "id": "ef18518d…", "name": "agent-board", "createdAt": "2026-10-10T22:59:43Z" },
  "version": "781ad752…",
  "cursor": "f1:ef18518d…:781ad752…",
  "locale": "ja",
  "epics": [
    {
      "id": "SPEC-MIGRATION",
      "name": "Move the specifications into the repository",
      "documentPath": "…/epics/SPEC-MIGRATION/EPIC.md",
      "wavesError": false,
      "tasks": [
        {
          "id": 98,
          "title": "Clean up after the merge",
          "assignee": "ai",
          "taskStatus": "todo",
          "agentStatus": "idle",
          "draft": null,
          "acceptance": { "done": 0, "total": 3 },
          "acceptanceError": false,
          "taskPath": "…/tasks/98/TASK.md"
        }
      ]
    }
  ],
  "nextTasks": [
    {
      "id": 98,
      "title": "Clean up after the merge",
      "epicId": "SPEC-MIGRATION",
      "taskPath": "…/tasks/98/TASK.md",
      "why": "next_in_epic"
    }
  ],
  "unassigned": []
}
```

- Only Todo and Doing tasks that are not waiting for a person appear. Tasks are grouped by epic in `waves` order; tasks without an epic are in `unassigned`.
- `nextTasks` is always present and holds at most three AI tasks to pick up now: `{ "id", "title", "epicId", "taskPath", "why" }`. `epicId` is `null` for a task without an epic. `why` is a stable value: `resume` for a Doing task with an Idle run state (stalled work), `next_in_epic` for a Todo task with an Idle run state. Tasks in Doing come first, then Todo; within each group the order is the progress table's (epics in table order, each epic's `waves` order, tasks without an epic last). Drafts, Pending and Running tasks, human-owned tasks, and Done or archived tasks are never listed; the array is empty when none qualifies. A Todo task is not listed while a non-archived task of an earlier wave of its epic is not Done; the tasks of one wave are listed together. Other dependencies between tasks are prose in `EPIC.md` and are not evaluated, so an agent reads the epic document before starting one.
- With `--include-pending` and `--include-done COUNT` (on `progress` and `hook`), the table also has a `pending` array and a `done` array. `pending` holds Todo and Doing tasks waiting for a decision, in ID order, each with a `question`: the open question with the smallest ID, up to 200 characters. `done` holds the `COUNT` most recently completed tasks, newest first, limited to epics that still have a Todo or Doing task. Without the options neither field is present.
- When a person's request is open (not accepted and not withdrawn), the table has a `requests` array in ID order. Each entry is `{"id":"Q-3","createdAt":"…","title":"…"}`: `title` is the first non-empty line of the request as plain text, without Markdown marks (heading, list, and quote markers, emphasis, code, and links), up to 80 characters (longer ones end with `…`). Without an open request the field is absent. An agent reads the whole text with `message show` and takes the request with `message accept`.
- When a person has answered a question and no agent has taken the answer in (the reply has no `acceptedAt`), the table has an `answers` array in ID order. Each entry is `{"id":"Q-12","title":"…","tasks":[21,22],"choiceId":"keep","choiceLabel":"Keep","text":null,"answeredAt":"2026-11-17T09:00:00Z"}`: `title` follows the same rule as a request's title, `tasks` lists the unarchived tasks that refer to the question, and `choiceId`, `choiceLabel`, and `text` are `null` when the answer has no such part: a note-only answer to a question with choices has `choiceId` and `choiceLabel` `null` and `text` set. Without such an answer the field is absent. An agent reads the whole answer with `message show` and takes it in with `message accept`.
- When an AI task has at least one acceptance condition, all of them done, and no `--final` result, the table has a `finalResultMissing` array in ID order, at most five entries: `{"id":21,"title":"…","taskPath":"…/tasks/21/TASK.md"}`. A task is listed while it is still in Todo or Doing, and for 24 hours after its lane changed to Done, which covers automatic Done happening before the agent writes the result. Drafts, human tasks, archived tasks, and tasks with invalid conditions are never listed. The agent records `result add --final` for each entry, and recording it removes the entry. Nothing is blocked or delayed: automatic Done does not wait for the result. Without such a task the field is absent.
- `epicsToClose` lists epics (other than `BUG` and `ENHANCEMENT`) whose unarchived tasks are all Done and whose `EPIC.md` body still has an unchecked `- [ ]`, in ID order: `[{"id":"SPEC-MIGRATION","name":"…","documentPath":"…/epics/SPEC-MIGRATION/EPIC.md"}]`. It is left out when none qualifies.
- A running AI task carries `lastActivityAt`, the time of its latest history entry or, when it has none, of its last run-state change: `{"id":98,…,"agentStatus":"running","lastActivityAt":"2026-11-20T03:12:00Z"}`. An AI task in Doing with a `--final` result carries `"hasFinalResult": true`. Both are left out otherwise. The `stale-running` and `conditions` rules read them.
- `reminders` lists what the [nudge rules](../concepts/agents.md#nudge-rules) that read only this table found: `[{"rule":"final-result","kind":"definite","text":"Task #21 has all conditions met but no final result: record agboard result add 21 --final ...","taskId":21}]`. `rule` is the rule's id. `kind` is `definite` for a violation the rule verified and `check` for something the agent should judge. `text` is the reminder. `taskId`, `messageId`, and `epicId` appear only when the reminder is about one. The entries follow the registry order. The hook attaches the table during work, so the reminders reach the agent without a command. Without a reminder the field is absent. The existing fields are unchanged.
- There are no bodies and no history. Agents read the `documentPath` and `taskPath` files they need.
- `cursor` is what `wait --after` takes.
- `locale` is the language saved in the board's settings, a short hint for the language of the agent's replies. It is read from `<data-root>/.internal/preferences.json` without the server, and is present only when the saved language is not English (today, `"ja"`). It is absent for English, when no language is saved, and when the file is missing or invalid, so existing readers are unaffected. The text form of `agboard progress` does not show it.
- The paths appear only in local CLI and hook output, never in remote JSON.
- The earlier `planPath` field is no longer produced or accepted. See the [data guide](../../guide/operations/data.md).

## Hook output

`agboard hook --agent claude|codex` writes JSON for the agent:

```json
{ "hookSpecificOutput": { "hookEventName": "PostToolUse", "additionalContext": "AGBOARD_PROGRESS\n{…}" } }
```

- `additionalContext` is `AGBOARD_PROGRESS` followed by the table above, or `AGBOARD_ERROR` followed by a body with a `code` and a reason, and a reminder not to make board-dependent changes.
- `AGBOARD_ERROR` codes: `bound_project_missing`, `project_not_found`, `board_unavailable`, `context_too_large`, `invalid_hook_input` (bad JSON, or a `cwd` that is not a string or not absolute), and `hook_cwd_unavailable` (the `cwd` does not exist or cannot be read). `folder_unbound` is no longer a hook output.
- **Silent skip.** When the bindings are valid, the `cwd` is readable, and no binding matches, the hook writes nothing to stdout or stderr and exits 0, so a Global Hook does not disturb work in folders with no project. See [Hook skip and errors](../concepts/agents.md#hook-skip-and-errors).
- **Stop.** On the Stop event the hook writes nothing, or once `{ "decision": "block", "reason": "..." }` when a rule gives a checklist item at the end of the turn (a question not on the board, an unrecorded result). The reason is a checklist: confirmed violations under `Found:` as `- NG: ...`, and items for the agent to judge under `Check:` as `- [ ] ...`. See [Stop](../concepts/agents.md).
- When it adds a table, the hook also starts the server in the background if none runs. Its output does not change, and failures are left in `serve.log`.
- Limits: 256 KiB for the table, 10 seconds per run. The input is read whatever its size; only `hook_event_name` and `cwd` are used. Over the limit, the hook reports `context_too_large`; it never truncates and calls it a success.

## Snapshot and wait

`agboard snapshot --json` and `agboard wait --after <cursor> --json` return the project snapshot: `fetchedAt`, `project`, `version`, `cursor`, `epics`, `tasks` (each with full history), `nextTaskId`, and `problems`. Use the new `cursor` for the next `wait`.

`wait` blocks until the project's version differs from the cursor. It exits with an error instead of a snapshot for `wait_timeout`, `board_unavailable`, `cursor_invalid`, and `project_not_found`; none of them means "answered". See [Error codes](./errors.md).

`wait --until task --idle-timeout <seconds> --json` selects one eligible AI-owned Todo or Doing task with an Idle run state, including tasks that existed before listening began. A Todo task is not selected while an earlier wave of its epic has a task that is not Done. The selection order matches the progress table. The result includes the task and local paths for its `TASK.md` and, when assigned to an epic, `documentPath` for its `EPIC.md`. Selection does not claim or edit the task.

Abbreviated example; task fields are omitted.

```json
{"kind":"task","projectId":"<id>","cursor":"<cursor>","task":{"id":1},"taskPath":"…/tasks/1/TASK.md","documentPath":"…/epics/DESIGN/EPIC.md"}
```

When an answer has not been taken in, the wait returns it before anything else. The result lists every such answer in the same shape as the progress table's `answers`. The agent reads it with `message show`, acts on it, takes it in with `message accept`, and then listens again; until it does, the next wait returns the same answer.

```json
{"kind":"answers","projectId":"<id>","cursor":"<cursor>","answers":[{"id":"Q-12","title":"Keep the old records?","tasks":[21],"choiceId":"keep","choiceLabel":"Keep","text":null,"answeredAt":"2026-11-17T09:00:00Z"}]}
```

When no answer waits and a request is open, the wait returns the request before any task, because a person asked for it. The result lists every open request in the same shape as the progress table. The agent reads one with `message show`, takes it with `message accept`, and then listens again; until it does, the next wait returns the same request. The order is answers, then requests, then tasks.

```json
{"kind":"requests","projectId":"<id>","cursor":"<cursor>","requests":[{"id":"Q-3","createdAt":"2026-11-17T09:00:00Z","title":"Add a reset link"}]}
```

If the requested interval passes with no eligible task, no open request, and no answer to take in, the command returns a successful result (exit code 0):

```json
{"kind":"idle_timeout","projectId":"<id>","idleTimeoutSeconds":300}
```

The timeout is required and ranges from 1 to 86,400 seconds. Connection, project, data, and argument errors remain errors; they are not encoded as `idle_timeout`. See [Error codes](./errors.md#server-and-waiting).

## Open

`agboard open --json` starts the server when none runs (unless `AGBOARD_AUTOSTART=0`), opens the board of the bound or named project, and prints one object:

```json
{"url":"http://127.0.0.1:7420/?project=<id>","projectId":"<id>","opened":true}
```

`opened` is `false` with `--print`, and when the browser may not be opened; then `notice` says why, for example `"AGBOARD_OPEN_BROWSER=0 turns opening the browser off."`. A server that cannot be reached is `board_unavailable`, and a program that cannot be started is `browser_open_failed`. See [Error codes](./errors.md#server-and-waiting).

## Remote

`agboard --project <name> show remote --json` asks the running server for the ngrok connection and prints one object when it is `ready`. The saved settings are in the same object:

```json
{"status":"ready","url":"https://<name>.ngrok-free.app/?project=<id>","entrance":"https://<name>.ngrok-free.app","passcode":"2418","project":{"id":"<id>","name":"<name>"},"enabled":true,"domain":"example.ngrok-free.dev","tokenSaved":true,"keychainAvailable":true}
```

`url` opens the board of the named project, and `entrance` is the address without a project. A named project that does not exist is `project_not_found`. `show <id>` still shows a task; `remote` is the one word that `show` takes in place of a task ID.

Anything else prints nothing on standard output and exits 1 with `remote_unavailable`: no server is running, or the connection is not `ready`. The error carries no address and no passcode. The server answers this only on its local address, so the passcode reaches the person at this computer and never passes through the tunnel. See [Error codes](./errors.md#server-and-waiting).

Without `--project`, `agboard show remote --json` never fails because the connection is down, and prints no passcode and no project address:

```json
{"enabled":true,"domain":"example.ngrok-free.dev","tokenSaved":false,"keychainAvailable":true,"status":"ready","entrance":"https://<name>.ngrok-free.dev"}
```

`status` is `no_server` when no server runs and `unknown` when the server did not answer; otherwise it is the state of the connection (`ready`, `disabled`, `starting`, `reconnecting`, `failed`, and so on). `entrance` is the address only while the connection is `ready`, else `null`. The ngrok token is never in the output; `tokenSaved` says whether the OS keychain holds one.

`agboard setup remote --domain … --enabled … --token-stdin --json` prints the saved settings in the same four fields (`enabled`, `domain`, `tokenSaved`, `keychainAvailable`), with `saved: true` and a `note` that says the settings apply the next time the connection starts.

## message events

`agboard message ask --actor ai --questions-json <json|-> [--task <id>]…` takes:

```json
{
  "questions": [
    {
      "body": "Should existing records be deleted or kept?",
      "choices": [
        { "id": "delete", "label": "Delete them and start clean" },
        { "id": "keep", "label": "Keep them and migrate" }
      ],
      "recommendedChoiceId": "keep",
      "tasks": [12]
    }
  ]
}
```

- `questions`: 1 to 20 items, and each becomes its own question file (`Q-<n>`). Each has a `body` (Markdown, 1 to 5,000 characters).
- Optional per question: `choices` (2 to 10 items; each choice `id` is 1 to 64 characters of `[A-Za-z0-9_-]` and unique in the question, and each `label` is 1 to 200 characters), `recommendedChoiceId` (one of the choices), `images`, and `tasks`, the IDs of tasks that refer to that question. A `--task` task refers to every question. A question without `choices` is answered with text. Unknown fields are refused.
- `images` is a list of image file paths that the CLI reads and stores as `qa/Q-<n>/attachments/<file name>`, checked like the images of a request: PNG, JPEG, WebP, or GIF, at most 20 files and 50 MiB in all, with unique plain names. The body shows one as `![](attachments/<file name>)`. One bad image fails the whole command with nothing saved. The output does not list the images; the body is the reference.
- `--timeout` is 1 to 86,400 seconds, or `none` (default 600). `--heartbeat` is 10 to 600 seconds (default 60). `message wait Q-<n> [Q-<n>]…` takes the same two options.

With `--json`, `message ask` and `message wait` write one JSON object per line. Each has a `type`:

| `type` | Fields | When |
| --- | --- | --- |
| `registered` | `questions` (`id`), `resumed` | First. `resumed` is `true` for `message wait`. With `--no-wait` it is the only line, and the command exits 0. |
| `waiting` | `ids`, `elapsed`, `remaining` (`null` without a timeout), `answered`, `total` | Every `--heartbeat` seconds. It comes from a timer and never reads the board. |
| `answered` | `ids`, `answers` (`id`, `choiceId`, `choiceLabel`, `text`, `via`, `at`) | Last, once no question is open. Exit 0. |
| `timeout` | `ids`, `answered`, `total` | Last, when `--timeout` passes first. The questions stay open. Exit 5. |
| `withdrawn` | `ids` (the withdrawn questions), `answers` | Last, when no question is open any more and some were withdrawn. Exit 6. |
| `error` | `error` (`code`, `message`, `reason`) | Last, when waiting fails, for example with `board_unavailable`. |

A waiting `message ask` checks the server before it saves anything. `--no-wait` saves without the server.

The other `message` commands print one JSON object with `--json`:

| Command | Output |
| --- | --- |
| `message answer` | `{questions}`: the recorded questions. When a question already has a reply, the error output adds `questions` with the recorded reply. |
| `message ls` | `{messages}`: questions and requests together. |
| `message show` | `{question}` or `{request}`. |
| `message send` | `{request}`. |
| `message accept` | `{request}` for a request, `{question}` for an answered question. The text output for a question is `Accepted the answer of Q-12.` |
| `message withdraw` | `{question}` or `{request}`, whichever was withdrawn. |

A question has `id`, `type`, `from`, `to`, `body`, `tasks`, `choices`, `recommendedChoiceId`, `reply` (`choiceId`, `choiceLabel`, `text`, `via`, `at`, `acceptedAt`, or `null`), `status`, `referencedBy`, `createdAt`, and `withdrawnAt`. In a reply, `acceptedAt` is always present: `null` until an agent takes the answer in, then a timestamp. `message show` prints an `Accepted at …` line for an accepted answer. A request has `id`, `type`, `from`, `to`, `body`, `status`, `acceptedAt`, `withdrawnAt`, and `createdAt`. The statuses are described in [Messages](./files.md#messages).

`message ask` and `message wait` accept the answers they return when the wait ends because the questions were answered or withdrawn; a timeout accepts nothing. An answer an agent records for a person from the chat (`message answer --via chat`) is written already accepted. So `message accept` is needed only for an answer the agent saw through the hook, the progress table, or `wait --until task`.

## Sample cards of the first-run guide

The progress table, the hook output, and `wait --until task` leave out the cards that carry an `onboardingSample` identity, whatever their lane or state. See [agent integration](../concepts/agents.md#sample-cards-of-the-first-run-guide).