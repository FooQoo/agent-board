# Listen for tasks in one session

Use this procedure only when the user explicitly asks you to listen for work. It keeps one already-open agent session working through one project's eligible tasks in order. It does not start an agent, resume a closed conversation, or claim tasks.

## Start listening

1. Resolve the project using the normal [project selection rules](../SKILL.md#1-resolve-the-project-from-the-working-folder), unless the user specifies an explicit project. Use its current name for commands; the wait operation resolves the name once and then follows that immutable ProjectId through a rename. Never broaden the session to other projects.
2. Confirm the idle timeout in seconds. It must be a positive integer from 1 to 86,400. There is no default. If the user has not specified it, ask on a relevant AI task in Agent Board using a choice-based Pending request with `"wait": {}`. Do not silently invent a duration.
3. Read the complete project snapshot and inspect every AI task's `agentStatus` before entering or resuming the listener; `progress` omits Pending tasks. If any task is `running` or `pending`, resolve that work first. A Pending request blocks the session until that same request is answered or explicitly withdrawn. If all AI tasks are `idle`, a task in the Doing lane may be continued without resetting its lane.
4. Start the listener with the normal shell execution tool:

   ```sh
   agboard --project "<current project name>" wait --until task --idle-timeout <seconds> --json
   ```

   Do not add `--after` or `--timeout`; task mode requires `--idle-timeout`. Keep the command running in this session until it returns. Do not use a separate background agent or external session-resume mechanism.

## Process one returned task

The command returns a single task as soon as any eligible task exists, including tasks created before listening began. Eligible tasks are AI-owned, in Todo or Doing, with `agentStatus: idle`, not drafts, and not archived. The order matches the progress table: epics sorted by ID, saved priority within each epic then task ID, then ungrouped tasks by ID. It does not prioritize creation time.

The output includes `projectId`, `cursor`, the task, `taskPath`, and `planPath` (null without an epic). It does not change task state or reserve the task. Before acting:

1. Read the returned task's latest `TASK.md`, its epic `PLAN.md` when present, attachments, and relevant history. Re-read the current project state and check that the task is still Todo or Doing and `agentStatus: idle`.
2. Preserve the user's original request, including its `## 元の依頼` section and image attachments. Review and clarify the title using the [normal work loop's title rules](../SKILL.md#6-work-loop) before starting; keep a title that is already clear. Structure the description and acceptance conditions only as needed to carry out and verify the same request. For `BUG` and `ENHANCEMENT`, follow the [fixed-body exception](../SKILL.md#fixed-bodies-for-bug-and-enhancement): keep task plans and results in the task, without appending to the epic body. Never turn an empty acceptance list into evidence of completion.
3. Check the approved plan, dependencies, and any task-specific approval boundary. Task selection is not authorization. If an implementation decision or required approval is missing, leave the task unstarted and ask with a Pending request. Do not skip to a later task while the same session is waiting for that answer.
4. Only when ready to begin, move a Todo task to Doing and set it to Running, each with a reason. If it is already in Doing, leave the lane unchanged and set it to Running. Work within the request and project policy. Record meaningful progress and verification. If a new decision is needed, use the existing Pending request flow with `"wait": {}` in the same session; after it returns, read the answer and history, then resume that task with a reason before continuing.
5. After verification, record the result and evidence in the task body, record verification in history, and mark only verified acceptance conditions done. Let Agent Board complete an eligible task automatically; do not manually move it to Done. Respect any project boundary for commits, pushes, or pull requests.

When the task is resolved or intentionally paused with its current state and reason recorded, call `wait --until task --idle-timeout <seconds> --json` again. Every call gets a fresh idle interval. An unrelated change does not reset the active call's deadline.

## Endings and interruptions

- `{"kind":"idle_timeout", ...}` is a successful exit (code 0). Finish the listener loop and report that the chosen interval passed with no eligible task. It does not mean any earlier task succeeded.
- `{"kind":"task", ...}` is a successful single-task result. Inspect and process it before calling wait again.
- `board_unavailable`, malformed project data, a mismatched server, or `project_not_found` is an error, not an empty board. Stop and report the error and its recovery step; do not start another wait as an automatic retry.
- Invalid arguments are usage errors. Fix the command rather than interpreting them as idle completion.
- If the wait or agent session is interrupted, do not report normal idle completion. On a human-started resumption, fetch a fresh complete snapshot and task history, inspect every AI task by `agentStatus`, and resolve any `running` or `pending` work before listening again. When all AI tasks are `idle`, Doing tasks remain eligible. A closed session is not resumed automatically.

## Difference from waiting for a change or an answer

- `wait --after <cursor> [--timeout <seconds>]` waits for a project version change and returns a snapshot. Its optional timeout is an error (`wait_timeout`), not a successful idle ending.
- `state <id> pending --request-json <json>` with `"wait": {}` waits for a specific decision answer in the same command. A timeout or interruption never withdraws the question.
- `wait --until task --idle-timeout <seconds>` waits for one eligible task and returns it, or exits normally with `idle_timeout` after a continuous interval with no eligible task.

All three use the event-driven wait engine. They have different conditions and return values; never interpret one mode's timeout or result as another mode's success.
