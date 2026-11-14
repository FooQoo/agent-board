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
  "epics": [
    {
      "id": "SPEC-MIGRATION",
      "name": "Move the specifications into the repository",
      "documentPath": "…/epics/SPEC-MIGRATION/EPIC.md",
      "priorityError": false,
      "tasks": [
        {
          "id": 98,
          "title": "Clean up after the merge",
          "assignee": "ai",
          "taskStatus": "todo",
          "agentStatus": "idle",
          "isDraft": false,
          "acceptance": { "done": 0, "total": 3 },
          "acceptanceError": false,
          "taskPath": "…/tasks/98/TASK.md"
        }
      ]
    }
  ],
  "unassigned": []
}
```

- Only Todo and Doing tasks that are not waiting for a person appear. Tasks are grouped by epic in `priority` order; tasks without an epic are in `unassigned`.
- With `--include-pending` and `--include-done COUNT` (on `progress` and `hook`), the table also has a `pending` array and a `done` array. `pending` holds Todo and Doing tasks waiting for a decision, in ID order, each with a `question`: the open question with the smallest ID, up to 200 characters. `done` holds the `COUNT` most recently completed tasks, newest first, limited to epics that still have a Todo or Doing task. Without the options neither field is present.
- There are no bodies and no history. Agents read the `documentPath` and `taskPath` files they need.
- `cursor` is what `wait --after` takes.
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
- Limits: 64 KiB of input, 256 KiB for the table, 10 seconds per run. Over the limit, the hook reports `context_too_large`; it never truncates and calls it a success.

## Snapshot and wait

`agboard snapshot --json` and `agboard wait --after <cursor> --json` return the project snapshot: `fetchedAt`, `project`, `version`, `cursor`, `epics`, `tasks` (each with full history), `nextTaskId`, and `problems`. Use the new `cursor` for the next `wait`.

`wait` blocks until the project's version differs from the cursor. It exits with an error instead of a snapshot for `wait_timeout`, `board_unavailable`, `cursor_invalid`, and `project_not_found`; none of them means "answered". See [Error codes](./errors.md).

`wait --until task --idle-timeout <seconds> --json` selects one eligible AI-owned Todo or Doing task with an Idle run state, including tasks that existed before listening began. The selection order matches the progress table. The result includes the task and local paths for its `TASK.md` and, when assigned to an epic, `documentPath` for its `EPIC.md`. Selection does not claim or edit the task.

Abbreviated example; task fields are omitted.

```json
{"kind":"task","projectId":"<id>","cursor":"<cursor>","task":{"id":1},"taskPath":"…/tasks/1/TASK.md","documentPath":"…/epics/DESIGN/EPIC.md"}
```

If the requested interval passes with no eligible task, the command returns a successful result (exit code 0):

```json
{"kind":"idle_timeout","projectId":"<id>","idleTimeoutSeconds":300}
```

The timeout is required and ranges from 1 to 86,400 seconds. Connection, project, data, and argument errors remain errors; they are not encoded as `idle_timeout`. See [Error codes](./errors.md#server-and-waiting).

## qa events

`agboard qa ask --request-json <json> --task <id>…` takes:

```json
{
  "questions": [
    {
      "question": "Should existing records be deleted or kept?",
      "choices": [
        { "id": "delete", "label": "Delete them and start clean" },
        { "id": "keep", "label": "Keep them and migrate" }
      ],
      "recommendedChoiceId": "keep"
    }
  ]
}
```

- `questions`: 1 to 20 items. Each has a `question` (Markdown, 1 to 5,000 characters) and 2 to 10 `choices`; each choice `id` is 1 to 64 characters of `[A-Za-z0-9_-]` and unique in the question, and each `label` is 1 to 200 characters.
- Optional per question: `kind` (`task` by default, `plan`, or `start_approval`), `recommendedChoiceId`, `approvingChoiceIds` (required for `start_approval`), and `tasks`, the IDs of extra tasks that refer to that question only. `--task` tasks refer to every question. Unknown fields are refused.
- `--timeout` is 1 to 86,400 seconds, or `none` (default 600). `--heartbeat` is 10 to 600 seconds (default 60). `qa wait <request-id>` takes the same two options.

With `--json`, `qa ask` and `qa wait` write one JSON object per line. Each has a `type`:

| `type` | Fields | When |
| --- | --- | --- |
| `registered` | `requestId`, `questions` (`id`, `kind`), `resumed` | First. `resumed` is `true` for `qa wait`. With `--no-wait` it is the only line, and the command exits 0. |
| `waiting` | `requestId`, `elapsed`, `remaining` (`null` without a timeout), `answered`, `total` | Every `--heartbeat` seconds. It comes from a timer and never reads the board. |
| `answered` | `requestId`, `answers` (`id`, `choiceId`, `choiceLabel`, `text`, `via`, `at`) | Last, once every question has an answer. Exit 0. |
| `timeout` | `requestId`, `answered`, `total` | Last, when `--timeout` passes first. The questions stay open. Exit 5. |
| `withdrawn` | `requestId`, `reason` | Last, when the request was withdrawn. Exit 6. |
| `error` | `error` (`code`, `message`, `reason`) | Last, when waiting fails, for example with `board_unavailable`. |

A waiting `qa ask` checks the server before it saves anything. `--no-wait` saves without the server.

`qa answer --json` prints the recorded questions as `{questions}`. When a question already has an answer, the error output adds `questions` with the recorded answer.

## Sample cards of the first-run guide

The progress table, the hook output, and `wait --until task` leave out the cards that carry an `onboardingSample` identity, whatever their lane or state. See [agent integration](../concepts/agents.md#sample-cards-of-the-first-run-guide).