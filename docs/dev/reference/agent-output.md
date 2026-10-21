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

- Only non-Pending Todo and Doing tasks appear. Tasks are grouped by epic in `priority` order; tasks without an epic are in `unassigned`.
- With `--include-pending` and `--include-done COUNT` (on `progress` and `hook`), the table also has a `pending` array and a `done` array. `pending` holds Todo and Doing tasks waiting for a decision, in ID order, each with a `question` of up to 200 characters. `done` holds the `COUNT` most recently completed tasks, newest first, limited to epics that still have a Todo or Doing task. Without the options neither field is present.
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
- `AGBOARD_ERROR` codes: `folder_unbound`, `bound_project_missing`, `project_not_found`, `board_unavailable`, and `context_too_large`.
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

## Decision requests

`agboard state <id> pending --request-json <json>` takes:

```json
{
  "question": "Should existing records be deleted or kept?",
  "choices": [
    { "id": "delete", "label": "Delete them and start clean" },
    { "id": "keep", "label": "Keep them and migrate" }
  ],
  "wait": {}
}
```

- `question`: 1 to 2,000 characters. `choices`: 2 to 10 items; each `id` is 1 to 64 characters of `[A-Za-z0-9_-]` and unique in the request; each `label` is 1 to 200 characters.
- `wait: {}` makes the command wait for the answer. An optional `timeoutSeconds` (1 to 86400) limits only the waiting command; the question stays Pending.
- The waiting command returns the updated task and the answer separately:

```json
{ "task": { "…": "…" }, "answer": { "actor": "human", "choiceId": "keep", "choiceLabel": "Keep them and migrate", "text": null } }
```
