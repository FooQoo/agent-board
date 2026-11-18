# Drafts and archived tasks

- A task with `"draft": "human"` is being written by the user. `edit`, `mv`, `state`, and `history add` fail with `task_is_draft`. Do not retry and do not edit its `TASK.md`. Work on other tasks and wait for the user to finalize it.
- Tasks and epics you create start as AI drafts (`"draft": "ai"`), also tasks for the user. You can `edit` them and run `history add`; `mv` and `state` fail with `task_is_draft`. Start them with `start` or `epic start` (`--actor ai`) once their questions are answered; an open question on a draft refuses the start with `start_blocked_by_questions`. A person may start them too.
- An epic with `"draft": "human"` is being edited by the user. `epic edit`, including `--priority`, fails with `epic_is_draft`. `epic attachment` and moving tasks into or out of the epic still work. Do not edit its `EPIC.md`.
- Archived tasks are not in the normal snapshot. Writes to them fail with `task_archived`.
