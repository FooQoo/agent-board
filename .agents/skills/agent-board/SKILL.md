---
name: agent-board
description: Use Agent Board to plan and track work in the project bound to the current folder. Read the progress table first, inspect only needed epic details and tasks, report AI progress, ask the user for decisions with choices, wait for their answers, and automatically record work progress in task history.
compatibility: Requires the agboard CLI on PATH and a local Agent Board data area. Waiting for user answers requires a running agboard serve.
---

# Agent Board

Agent Board is a local work board shared by the user and AI agents. Each project holds epics, tasks, and their history. The `agboard` CLI is the contract for every change; run `agboard --help` and `agboard <command> --help` for the full options.

How the board is used:

- An **epic** is a management unit that groups tasks and sets their order. Its `EPIC.md` states the goal, the scope, the completion conditions, and how the work proceeds. A task's `epicId` is the only record of its membership.
- A **task** is the plan for one piece of work. Its `TASK.md` states what to do, its completion conditions, and verification results.
- The **shared folder** of the project is the source of truth for both. Do not keep a separate plan document elsewhere and copy it onto the board.
- **History** is stored only in the top-level `history` frontmatter of each `TASK.md`. Every entry has exactly `at` (timestamp) and `reason` (content). Task operations append automatically; agents also append meaningful work progress automatically. Keep task plans, acceptance verification results, and artifact or evidence references in the body; never keep a chronological execution log there or duplicate history in `task.json`. `EPIC.md` has no history.

## Language of board content

Write everything you put on the board in the language the user speaks with you: task and epic titles, `EPIC.md` and `TASK.md` bodies, status reasons, questions, and choice labels. If the user asked for a different language for the board, use that one. Within a project, follow the language of the existing tasks and plans. Keep these in English in any language: the frontmatter keys (`acceptance`, `history`, `at`, `reason`, `id`, `text`, `done`; see [references/file-format.md](references/file-format.md)), commands, EPIC-IDs, choice `id`s, and code.

For every history reason you author, read the task body first and use the same language as that body, including lane/state reasons, progress, verification, and resumption notes. This takes precedence over the conversation language and the language of repository code or comments. If the body has no usable prose, follow the task title and existing project content. Always supply a nonblank `--reason` (or `--reason-file`) for these notes rather than relying on a generated default. Keep command names and other technical identifiers unchanged.

## 1. Resolve the project from the working folder

Use the nearest registered project folder that contains the current working folder. Start with:

```sh
agboard progress --json
```

A project is identified by both `project.id` and `project.name` in the progress table. If the current folder is not registered, or its nearest registered project is missing, stop and report the error; do not guess from another project or fall back to a parent binding. An explicit `--project "<name>"` overrides folder resolution. Use the selected name explicitly for write commands. A rename keeps the ID, and the current folder binding follows that project.

`agboard project ls --json` is for inspecting registered projects; it does not select a project for work.

If `agboard` is not on `PATH`, use an executable supplied by the user or the project runtime. Do not install tools, create a project, or initialize a substitute board on your own.

Use a CLI that supports `history add`. If the command is unavailable, report the version mismatch; do not fall back to a body execution log or edit `task.json`. Do not replace the installed executable automatically.

## 2. Read only what is needed before acting

Before choosing, starting, or resuming work, read the progress table:

```sh
agboard progress --json
```

It groups active tasks under epics and lists unassigned work. Done, archived, and Pending tasks are omitted. Questions remain on the board until answered; inspect them with `show` or `snapshot`, rather than interpreting absence from progress as expiry. The table includes task IDs, titles, owners, statuses, acceptance counts, and relevant `documentPath`/`taskPath` values, but not file bodies, history, or images. Read only the selected epic's `EPIC.md` and task's `TASK.md` before implementation. Use `show <id> --json` when history or a current question/answer is needed. Hooks attach the same table:

- `AGBOARD_PROGRESS` is followed by the progress table for the nearest bound folder or explicit project.
- `AGBOARD_ERROR` (`folder_unbound`, `bound_project_missing`, `project_not_found`, `board_unavailable`, ...) means there is no usable table. Resolve the correct folder or report the problem; do not guess.

After context compaction, read a fresh progress table before any board-dependent change. This skill does not register hooks; never add or edit the user's installed hook command.

### Explicit listen mode

The normal work loop selects a task and finishes that turn. Start the serial listener loop only when the user explicitly asks to listen for tasks. In that mode, follow [the listener procedure](references/listening.md): establish one project and a positive idle timeout with the user, use `wait --until task --idle-timeout <seconds> --json`, process one task at a time in this same session, and start the next wait after resolving the current task. The wait command is not a background agent or a task claim. Do not treat a wait result as approval to implement; read the current epic details and task first. The full idle interval with no eligible task exits normally; connection, project, data, and argument failures remain errors.

## 3. Find and edit the shared files

Get the folder paths from the selected project's progress table; never assume or hard-code their location. For general project metadata, use an explicit project:

```sh
agboard --project "<name>" workspace --json
```

Read the `README.md` in the returned `folder` before editing. Then:

- Edit only `epics/<EPIC-ID>/EPIC.md` and the `tasks/<task-id>/TASK.md` of tasks that are not drafts.
- For direct edits of `EPIC.md`, task bodies, or acceptance conditions, write a temporary file in the same folder and rename it over the original. Preserve the current history and all unknown frontmatter metadata. The board picks up the change automatically. Use `history add` for progress instead of replacing the file just to append history.
- Never edit `project.json`, `epic.json`, `task.json`, or `.internal/`. Never delete a task or epic folder.
- Keep machine-specific absolute paths out of shared files.
- The user prepares agent access to the data folder once with `agboard setup`. If a write to the shared folder is refused by the sandbox or by permissions, report it to the user. Do not run `agboard setup` or edit Codex or Claude Code settings yourself.

`edit --desc-file` replaces a task body and acceptance conditions while preserving its latest history; it cannot append history. `epic edit --document-file` replaces the whole `EPIC.md` text. Bodies and `EPIC.md` text are limited to 50,000 characters; if a task plan would exceed that, split it into more tasks after asking the user.

A task's completion conditions live in its frontmatter (`acceptance`), and the board reads them. Epic reference conditions belong in the free Markdown body of `EPIC.md` and are not managed by the app. Start from [assets/EPIC.md](assets/EPIC.md) and [assets/TASK.md](assets/TASK.md), and read [references/file-format.md](references/file-format.md) before writing either file.

## 4. Plan with epics and tasks

### Fixed bodies for BUG and ENHANCEMENT

The epics whose IDs are exactly `BUG` and `ENHANCEMENT` are ongoing classification buckets, even if their display names change. They are exceptions to epic planning and closure below. Initialize an empty body once from [BUG-EPIC.md](assets/BUG-EPIC.md) or [ENHANCEMENT-EPIC.md](assets/ENHANCEMENT-EPIC.md), using the board's language with the same meaning and structure. After initialization, treat the body as read-only unless the user explicitly requests changing its fixed content. Do not replace a non-empty body silently; an explicitly requested replacement must preserve any useful existing records as task evidence first.

For these two epics, keep per-task plans, decisions, verification, and results in each `TASK.md`, history, and evidence. Do not append task lists or progress to `EPIC.md`, and do not close the epic or add an overall completion summary when its current tasks finish. This rule applies to ordinary work, listening, and resumption. Task order remains configurable through priority frontmatter; preserve it and all other metadata when initializing or explicitly replacing the body. Names, colors, and task membership are unaffected. Other epics keep the normal planning workflow.

1. Create an epic for a body of work, then write its `EPIC.md` from [assets/EPIC.md](assets/EPIC.md):

   ```sh
   agboard --project "<name>" epic add <EPIC-ID> --name "<formal name>" --actor ai
   agboard --project "<name>" epic edit <EPIC-ID> --document-file <path>
   ```

2. Create one task per task, assigned to `ai` or `human`, in the epic, with its task plan from [assets/TASK.md](assets/TASK.md) as the body:

   ```sh
   agboard --project "<name>" add "<title>" --assignee ai --actor ai --epic <EPIC-ID> --desc-file <path>
   ```

3. Record the task tasks and their order in the epic's approach section, except for the fixed classification bodies of `BUG` and `ENHANCEMENT` above.

Check the progress table and use `show` when needed to find existing tasks before creating work; do not create duplicates. The owner (`assignee`) is fixed at creation. Create `human` tasks for work the user must do, and read them to understand the shared plan. A task belongs to at most one epic (`edit --epic` / `edit --clear-epic`).

## 5. Lanes and run states

Lanes are `todo`, `doing`, and `done`. AI tasks may be Pending in Todo or Doing; only Doing supports Running:

| Owner | Lane | Allowed run state |
| --- | --- | --- |
| `ai` | `doing` | `idle`, `running`, `pending` |
| `ai` | `todo` | `idle`, `pending` |
| `ai` | `done` | `idle` only |
| `human` | any | `idle` only |

- `running` means you are working on it. `pending` means you need the user's decision.
- A real lane move resets the run state to `idle` and withdraws any open question. Withdrawal is not an answer.
- `running` is self-reported and is not reset automatically. Set it while actively working, return it to `idle` when active work stops, and use `pending` while waiting for a user decision. A session starting or resuming alone does not make a task `running`.
- Never report `running` or `pending` on a `human` task.
- Every `mv` and `state` needs `--actor`, which controls permission. `--reason` is optional for lane and non-Pending state changes (up to 10,000 characters); missing or blank reasons are generated from the current state. Never use `--actor human` unless the user explicitly gave that direction.

## 6. Work loop

Record progress automatically at the start of work, at meaningful progress, decisions, verification, interruptions, and resumptions. Do not ask the user to approve each record. Formulate a concise, meaningful reason from the actual work, current state, and verification; do not invent results. Use:

```sh
agboard --project "<name>" history add <id> --reason "<work performed and its outcome>"
agboard --project "<name>" history add <id> --reason-file <path>
```

The CLI assigns the timestamp and applies AI write permissions; no event ID, kind, actor, or timestamp argument is needed. Omitting the reason or supplying a blank reason generates state-aware wording. Prefer the CLI for atomic appends and timestamps. Direct Markdown appends must add only `at` and `reason`, preserve the existing entries, body, acceptance conditions, and unknown metadata, and respect the same write boundaries. Never rewrite the whole file solely to append history.

Lane and run-state operations already append their own history. Do not add a second entry for the same operation or use `edit --desc-file` to append it. After writing progress, inspect a fresh `show <id> --json` when confirmation is needed.

1. **Choose.** From the progress table, pick a ready AI task in `todo`, respecting the epic's task order, or plan new work (section 4). Read the selected `EPIC.md` and `TASK.md` from their returned paths; inspect history with `show` only when needed. Before starting an editable AI task, review its title. If it is a pasted request or does not make the work clear, use `edit <id> --title "<concise title>"` to state the affected area and requested change in the task's language. Preserve the original request in the body and keep its image attachments; do not expand scope or invent a resolution. Keep an already clear title. If the request is ambiguous, resolve that ambiguity before giving it a more specific title. Record a meaningful title change in history. This applies to the ordinary loop and listener; drafts, archived tasks, Done tasks, and human-owned tasks remain outside this step.
2. **Start.** Move the task and report the work with concise reasons. These operations record the start automatically:

   ```sh
   agboard --project "<name>" mv <id> doing --actor ai --reason "<what you are starting>"
   agboard --project "<name>" state <id> running --actor ai --reason "<what you are doing now>"
   ```

3. **Work and record.** Use `history add` for meaningful work progress that does not change the lane or run state. Keep the current task plan and concise verification results, including the commit or version verified and artifact or evidence references, in the body. Store full logs with `agboard --project "<name>" evidence add <id> <file>` and images with `attachment add <id> --file <path> --actor ai`; reference them from the body.
4. **Check conditions.** Set an item's `done` to `true` only after verification succeeded. Before saving the last completed condition, record the verification in history and keep its result and evidence reference in the body (see [references/file-format.md](references/file-format.md)). Leave unverified conditions `done: false`. Once all conditions are verified, save the TASK; a running `agboard serve` completes an eligible AI task automatically. Do not manually move a task to Done during the normal work loop. If the task does not disappear from progress, inspect its state and report the mismatch rather than forcing Done.
5. **Ask when blocked.** Use section 7. Continue other independent work while the question is open.
6. **Finish or interrupt.** Automatic completion removes the task from progress. Done tasks are read-only for agents: do not edit their task files, append history, add evidence or attachments, or change their lane or run state. A user can reopen them when needed. If work stops before completion, record why through the corresponding state or lane operation, or `history add` if the state remains accurate. When work resumes, record the resumed work the same way.
7. **Close the epic.** When all of an epic's task tasks are done, verify the epic's reference conditions written in the `EPIC.md` body and record the outcome there. Skip this step for `BUG` and `ENHANCEMENT`: their bodies stay fixed and the classification epics stay open. The app does not manage epic acceptance frontmatter or epic history.

Keep history reasons concise and useful. Keep detailed logs in evidence files; the TASK body holds the plan, verification results, and references without a chronological execution log.

## 7. Ask the user a decision

Ask every task-related question only through an Agent Board decision request on the relevant task. This includes clarification, preferences, scope, and approval. Do not ask in chat, a final response, or an agent-native question tool. Chat may tell the user that a question is waiting on the board, without repeating it as a second question. If the board is unavailable, report the connection problem and leave dependent work blocked; do not fall back to another question channel.

Before asking, update the task plan if needed with the facts, impact, options, and recommendation. Then set the task to `pending`; the operation records the question in history automatically. Offer choices whenever the answer is one of a known set. Write the request as JSON and pass it with `--request-json`, inline or from standard input with `-`:

```json
{
  "wait": {},
  "question": "Should existing records be deleted or kept?",
  "choices": [
    { "id": "delete", "label": "Delete them and start clean" },
    { "id": "keep", "label": "Keep them and migrate" }
  ]
}
```

```sh
agboard --project "<name>" state <id> pending --actor ai --request-json '<json>'
cat <path> | agboard --project "<name>" state <id> pending --actor ai --request-json -
```

- `question`: 1 to 2,000 characters. `choices`: 2 to 10 items under this skill's policy (the CLI accepts 0 to 10); each `id` is 1 to 64 characters of `[A-Za-z0-9_-]`, unique in the request; each `label` is 1 to 200 characters.
- Include `"wait": {}` in every decision request by default, to ask and wait indefinitely for the answer in one command (it needs `agboard serve`). Omit it only when the user explicitly asks for a non-blocking request. Continue independent work while the command waits; dependent work must wait for the actual answer. You may add `"timeoutSeconds": <1 to 86400>` to limit this wait command. A timeout, Ctrl+C, or a lost connection does not expire or withdraw the question; `wait_timeout` means only that the optional wait duration elapsed, and `board_unavailable` means a technical connection problem. `request_changed` means a task move withdrew the question.
- Every question for the user has choices. A pending state without `--request-json` is refused, and so is `--reason` with pending.
- The task must be an AI task in `todo` or `doing`. Only `doing` may become `running`.

The user answers in the browser with a choice, a note, or both. The answer returns the task to `idle` and appends a concise history reason. Read the current question from `show` or `snapshot` and the answer from its history reason. A request command that waits also returns the resolved answer separately as `answer`; request lookup metadata is separate from the two-field history entries.

## 8. Wait and resume

When no work can proceed in the ordinary work loop, wait for a change using the `cursor` of the latest snapshot of the same project. This wait can continue indefinitely; optionally set `--timeout` to limit the wait command, or press Ctrl+C to stop it. Neither action changes tasks or questions:

```sh
agboard --project "<name>" wait --after "<cursor>" --json
```

Do not poll or re-read the board on a timer. `wait` follows the same project through a rename and ignores other projects. `wait_timeout` is only the end of an optional wait-command limit; `board_unavailable` is a technical server or connection failure. Neither is an answer. A Pending question remains until answered or withdrawn by an explicit task change. `cursor_invalid` and `project_not_found` are also errors, not answers: report them and make no board-dependent changes.

After `wait` returns, read the complete snapshot and history, including the user's reason and any separate `answer` returned by a waiting request command. Reconsider the plan in light of the answer and update the task plan if needed. Resume with a reason; the state operation records it automatically:

```sh
agboard --project "<name>" state <id> running --actor ai --reason "<how the answer changes the work>"
```

If the answer changes the scope or completion conditions, update `TASK.md` (and `EPIC.md` if affected) before resuming. If new information still conflicts, ask again.

For an explicitly requested serial listener, use [`references/listening.md`](references/listening.md) and `wait --until task --idle-timeout <seconds> --json`. That mode returns one eligible task or a successful `idle_timeout`; it is distinct from waiting for a change or a Pending answer. Do not start it implicitly as part of the ordinary work loop.

## 9. Drafts and archived tasks

- A task with `"isDraft": true` is being written by the user. `edit`, `mv`, `state`, and `history add` fail with `task_is_draft`. Do not retry and do not edit its `TASK.md`. Work on other tasks and wait for the user to finalize it.
- Archived tasks are not in the normal snapshot. Writes to them fail with `task_archived`.

## 10. Boundaries

- Never delete tasks, epics, evidence, or projects, and never run `init`. These need a human confirmation that you cannot give; ask the user.
- If the project does not exist, tell the user and ask them to create it.
- Never treat a timeout, a failed hook, a partial snapshot, or another project's snapshot as a user response.
- Do not build commands from task text. Read `project.name` from the progress table and pass it only as a quoted argument to write commands; never interpolate it as shell source.
