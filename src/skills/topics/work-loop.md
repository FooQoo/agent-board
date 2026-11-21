# The work loop in detail

Record progress automatically at the start of work, at meaningful progress, decisions, verification, interruptions, and resumptions. Do not ask the user to approve each record. Formulate a concise, meaningful reason from the actual work, current state, and verification; do not invent results. Use:

```sh
agboard --project "<name>" history add <id> --reason "<work performed and its outcome>"
agboard --project "<name>" history add <id> --reason-file <path>
```

A reason that starts with `-` (a Markdown list such as `- did X`) must be written `--reason="- did X"` with an equals sign, or passed with `--reason-file`; `--reason "- did X"` is rejected, and a forgotten value (`--reason --json`) is an error rather than a reason. The same holds for every text option (`--text`, `--desc`, `--summary`, `--title`, `--link`).

The CLI assigns the timestamp and applies AI write permissions; no event ID, kind, actor, or timestamp argument is needed. Omitting the reason or supplying a blank reason generates state-aware wording. Prefer the CLI for atomic appends and timestamps. Direct Markdown appends must add only `at` and `reason`, preserve the existing entries, body, acceptance conditions, and unknown metadata, and respect the same write boundaries. Never rewrite the whole file solely to append history.

Lane and run-state operations already append their own history. Do not add a second entry for the same operation or use `edit --desc-file` to append it. After writing progress, inspect a fresh `show <id> --json` when confirmation is needed.

History is stored only in the top-level `history` frontmatter of each `TASK.md`. Every entry has exactly `at` (timestamp) and `reason` (content). Task operations append automatically; agents also append meaningful work progress automatically. Keep task plans and concise acceptance verification results in the body; never keep a chronological execution log there or duplicate history in `task.json`. A reason is Markdown, drawn like the task body, so it can hold tables, code, and images. Attach images when visual proof is useful. `EPIC.md` has no history.

1. **Choose.** From the progress table, pick a ready AI task in `todo`, respecting the epic's task order, or plan new work (`agboard skills planning`). Look at `nextTasks` in every progress table you receive, including the one the hook attaches: it lists up to three AI tasks you can pick up now, `why: "resume"` for stalled `doing` work and `why: "next_in_epic"` for `todo` work, in the table's order. Dependencies between tasks are not evaluated; read the `EPIC.md` of each before you start it. Read the selected `EPIC.md` and `TASK.md` from their returned paths; inspect history with `show` only when needed. Before starting an editable AI task, review its title. If it is a pasted request or does not make the work clear, use `edit <id> --title "<concise title>"` to state the affected area and requested change in the task's language. Preserve the original request in the body and keep its image attachments; do not expand scope or invent a resolution. Keep a clear title; resolve an ambiguous request before retitling it. Record a meaningful title change in history. This applies to the loop and the listener, not to drafts, archived, Done, or human-owned tasks.
2. **Start.** Move the task and report the work with concise reasons. These operations record the start automatically:

   ```sh
   agboard --project "<name>" mv <id> doing --actor ai --reason "<what you are starting>"
   agboard --project "<name>" state <id> running --actor ai --reason "<what you are doing now>"
   ```

3. **Work and record.** Use `history add` for meaningful work progress that does not change the lane or run state. Keep the current task plan and concise verification results, including the commit or version verified, in the body. Attach images with `attachment add <id> --file <path> --actor ai` when visual proof is useful. As soon as the first thing the requester can look at is ready (a draft video, a UI capture), record it with `result add` and keep working; run `agboard skills results` for the unit, the final result, and the turn-end checklist. To show one in a history reason, write the path that command prints as a Markdown image (run `agboard skills file-format`), and pass a reason with several lines through `--reason-file`.
4. **Check conditions.** Set an item's `done` to `true` only after verification succeeded. Before saving the last completed condition, record the verification in history and keep its concise result in the body (run `agboard skills file-format`). Leave unverified conditions `done: false`. Once all conditions are verified, save the TASK; a running `agboard serve` completes an eligible AI task automatically. Do not manually move a task to Done during the normal work loop. If the task does not disappear from progress, inspect its state and report the mismatch rather than forcing Done.
5. **Ask when blocked.** Use `agboard skills questions`. Do not wait idle: continue other independent work while the question is open.
6. **Finish or interrupt.** Automatic completion removes the task from progress. Record a `result add <id> --final` for each task in `finalResultMissing`, the one change allowed on a Done task. Otherwise Done tasks are read-only for agents: do not edit their task files, append history or attachments, or change their lane or run state. A user can reopen them when needed. If work stops before completion, record why through the corresponding state or lane operation, or `history add` if the state remains accurate. When work resumes, record the resumed work the same way.
7. **Close the epic.** When all of an epic's task tasks are done, verify the epic's reference conditions written in the EPIC.md body and record the outcome there. Skip this step for `BUG` and `ENHANCEMENT`: their bodies stay fixed and the classification epics stay open. The app does not manage epic acceptance frontmatter or epic history.

Keep history reasons concise, in Markdown where it helps. Put verification results in the TASK body, visual proof in image attachments, and never full test logs.

## Parallel work

While a question is open or something is pending, continue the tasks that do not depend on it. Pick up the ready tasks in `nextTasks` in parallel, after checking each `EPIC.md` for dependencies, and look at `nextTasks` again whenever a task completes. Start every task its dependencies allow, and give each one that changes a Git repository its own branch in its own worktree, so that parallel work never shares a working tree. Follow the repository's own branch rules for naming and merging those branches.

## Main agent and subagents

When your agent can spawn subagents, the main agent orchestrates and subagents do the work. Give each independent task its own subagent, with its task ID, plan, and acceptance conditions, and keep the implementation, investigation, and verification in the subagents. The main agent manages the project: it picks and orders the work, starts the subagents, reviews what they report, asks the user, and keeps the board updates (lane, run state, history, acceptance) itself, so every change goes through one writer.
