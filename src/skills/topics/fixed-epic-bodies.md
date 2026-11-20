# Fixed bodies for BUG and ENHANCEMENT

The epics whose IDs are exactly `BUG` and `ENHANCEMENT` are ongoing classification buckets, even if their display names change. They are exceptions to epic planning and closure below. Initialize an empty body once from the body in `agboard skills bug-epic-template` or `agboard skills enhancement-epic-template`, using the board's language with the same meaning and structure. After initialization, treat the body as read-only unless the user explicitly requests changing its fixed content. Do not replace a non-empty body silently; an explicitly requested replacement must preserve useful existing records in the relevant task bodies.

For these two epics, keep per-task plans, decisions, verification, and results in each `TASK.md` and its history. Do not append task lists or progress to `EPIC.md`, and do not close the epic or add an overall completion summary when its current tasks finish. This rule applies to ordinary work, listening, and resumption. Task order remains configurable through `waves` frontmatter; preserve it and all other metadata when initializing or explicitly replacing the body. Names, colors, and task membership are unaffected. Other epics keep the normal planning workflow.

1. Create an epic for a body of work, then write its `EPIC.md` from the template in `agboard skills epic-template`:

   ```sh
   agboard --project "<name>" epic add <EPIC-ID> --name "<formal name>" --actor ai
   agboard --project "<name>" epic edit <EPIC-ID> --document-file <path>
   ```

2. Create one task per task, assigned to `ai` or `human`, in the epic, with its task plan from the template in `agboard skills task-template` (with its recommended headings) as the body:

   ```sh
   agboard --project "<name>" add "<title>" --assignee ai --actor ai --epic <EPIC-ID> --desc-file <path>
   ```

3. Record the task tasks and their order in the epic's approach section, except for the fixed classification bodies of `BUG` and `ENHANCEMENT` above.

Check the progress table and use `show` when needed to find existing tasks before creating work; do not create duplicates. The owner (`assignee`) is fixed at creation. Create `human` tasks for work the user must do, and read them to understand the shared plan. A task belongs to at most one epic (`edit --epic` / `edit --clear-epic`).
