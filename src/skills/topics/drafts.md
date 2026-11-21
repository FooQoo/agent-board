# Drafts and archived tasks

- The Backlog (`taskStatus: backlog`) holds settled plans that must not be started yet. Never start a Backlog task. Only a person sends it to Todo (`send`, `epic send`); for an agent `send` and `epic send` fail with `human_only`, and `mv` and `state` fail with `task_in_backlog`. You can `edit` a Backlog task and run `history add`. Create one with `add --actor ai --backlog` only when a request asks for the plan only. A Backlog task in an epic keeps later waves waiting.
- A task with `"draft": "human"` is being written by the user. `edit`, `mv`, `state`, and `history add` fail with `task_is_draft`. Do not retry and do not edit its `TASK.md`. Work on other tasks and wait for the user to finalize it.
- Tasks you create without `--backlog` are ordinary Todo tasks, also tasks for the user. `draft` is only `null` or `"human"`.
- An epic with `"draft": "human"` is being edited by the user. `epic edit`, including `--waves`, fails with `epic_is_draft`. `epic attachment` and moving tasks into or out of the epic still work. Do not edit its `EPIC.md`.
- Archived tasks are not in the normal snapshot. Writes to them fail with `task_archived`.
