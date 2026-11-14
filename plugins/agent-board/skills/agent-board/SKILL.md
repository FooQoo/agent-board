---
name: agent-board
description: Use Agent Board to plan and track work in the project bound to the current folder. Read the progress table first, inspect only needed epic details and tasks, turn a request into a provisional plan on the board and get one start approval, report AI progress, ask the user questions with choices on the board and in the chat, wait for their answers, and automatically record work progress in task history.
compatibility: Requires the agboard CLI on PATH and a local Agent Board data area. Commands that wait for user answers start the local agboard server when it is not running.
---

# Agent Board

Agent Board is a local work board shared by the user and AI agents. Each project holds epics, tasks, and their history. The `agboard` CLI is the contract for every change; run `agboard --help` and `agboard <command> --help` for the full options.

How the board is used:

- An **epic** is a management unit that groups tasks and sets their order. Its `EPIC.md` states the goal, the scope, the completion conditions, and how the work proceeds. A task's `epicId` is the only record of its membership.
- A **task** is the plan for one piece of work. Its `TASK.md` states what to do, its completion conditions, and verification results.
- The **shared folder** of the project is the source of truth for both. Do not keep a separate plan document elsewhere and copy it onto the board.
- **History** is stored only in the top-level `history` frontmatter of each `TASK.md`. Every entry has exactly `at` (timestamp) and `reason` (content). Task operations append automatically; agents also append meaningful work progress automatically. Keep task plans and concise acceptance verification results in the body; never keep a chronological execution log there or duplicate history in `task.json`. A reason is Markdown, drawn like the task body, so it can hold tables, code, and images. Attach images when visual proof is useful. `EPIC.md` has no history.

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

If the error is `folder_unbound`, report it and show the user these steps to run themselves in a terminal: `agboard project create "<name>"` (or `agboard project bind "<name>"` for an existing project), and `agboard setup` if Agent Board is not set up yet for every agent they use. `agboard setup` installs this Skill and the Hook and asks the user to choose and confirm in a terminal; never run it, create or bind a project, or pick another project on the user's behalf, and keep working on tasks that do not need the board.

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

`edit --desc-file` replaces a task body and acceptance conditions while preserving its latest history; it cannot append history. `epic edit --document-file` replaces the whole `EPIC.md` text. Task bodies are limited to 50,000 characters and `EPIC.md` text to 100,000; if a task plan would exceed its limit, split it into more tasks after asking the user.

A task's completion conditions live in its frontmatter (`acceptance`), and the board reads them. Epic reference conditions belong in the free Markdown body of `EPIC.md` and are not managed by the app. Start from [assets/EPIC.md](assets/EPIC.md) and [assets/TASK.md](assets/TASK.md), and read [references/file-format.md](references/file-format.md) before writing either file.

## 4. Plan with epics and tasks

### Fixed bodies for BUG and ENHANCEMENT

The epics whose IDs are exactly `BUG` and `ENHANCEMENT` are ongoing classification buckets, even if their display names change. They are exceptions to epic planning and closure below. Initialize an empty body once from [BUG-EPIC.md](assets/BUG-EPIC.md) or [ENHANCEMENT-EPIC.md](assets/ENHANCEMENT-EPIC.md), using the board's language with the same meaning and structure. After initialization, treat the body as read-only unless the user explicitly requests changing its fixed content. Do not replace a non-empty body silently; an explicitly requested replacement must preserve useful existing records in the relevant task bodies.

For these two epics, keep per-task plans, decisions, verification, and results in each `TASK.md` and its history. Do not append task lists or progress to `EPIC.md`, and do not close the epic or add an overall completion summary when its current tasks finish. This rule applies to ordinary work, listening, and resumption. Task order remains configurable through priority frontmatter; preserve it and all other metadata when initializing or explicitly replacing the body. Names, colors, and task membership are unaffected. Other epics keep the normal planning workflow.

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

### Plan a request: provisional plan, plan questions, then one start approval

When the user asks for work that is more than one task, such as a feature, a change across several areas, or a list of things to do, put a provisional plan on the board first and let the user correct it. Do not ask before registering it: reacting to a plan is easier than describing one.

1. **Read.** Read the progress table and the relevant epics and tasks, so the plan reuses what exists and creates no duplicates.
2. **Register the provisional plan.** Create the epic (or use an existing one) and write its `EPIC.md`: goal, scope, completion conditions, and the tasks in work order with their dependencies. Create the tasks in that order, each with its owner, plan, and acceptance conditions; keep each to one piece of work that can be reviewed on its own. Document updates the work needs belong in a task's acceptance conditions. Start none of the tasks.
3. **Ask the plan questions.** Ask what you cannot settle yourself in one `qa ask` request of `plan` questions (section 7), each with choices and a recommendation. List every AI task of the plan in their `tasks`, so the plan stays Pending while you ask; when the request came from a board task, add that task too. With no plan questions, go to step 5.
4. **Revise.** Change the epic and the tasks as the answers say, and record what changed in history. If the answers leave something open, ask more `plan` questions the same way.
5. **Ask one start approval.** Right after revising, before anything else, ask one `start_approval` question that shows the revised plan, linked to the same tasks. They stay Pending until it is approved.

   ```json
   { "questions": [ { "kind": "start_approval", "question": "Start this plan?\n\n- #21 …\n- #22 …",
     "choices": [ { "id": "approve", "label": "Start this plan" }, { "id": "revise", "label": "Change the plan" } ],
     "recommendedChoiceId": "approve", "approvingChoiceIds": ["approve"], "tasks": [21, 22] } ] }
   ```

   If the user chooses to change the plan, revise it, ask a new `start_approval` linked to the tasks, and `qa unlink` the old approval from them. Silence, a timeout, or an unclear reply is not an approval.
6. **Proceed.** After approval, work through the epic's tasks in its order (section 6) without asking again, except in the four cases of section 7.

A task the user already put on the board needs no start approval to work on. Splitting an oversized task plan (section 3) is asked with a question on that task.

## 5. Lanes and run states

Lanes are `todo`, `doing`, and `done`. AI tasks may be Pending in Todo or Doing; only Doing supports Running:

| Owner | Lane | Allowed run state |
| --- | --- | --- |
| `ai` | `doing` | `idle`, `running`, `pending` |
| `ai` | `todo` | `idle`, `pending` |
| `ai` | `done` | `idle` only |
| `human` | any | `idle` only |

- `running` means you are working on it. `pending` means the task refers to a question that is still open. It is never set directly; it follows from the questions (section 7).
- A real lane move resets the run state to `idle`. It does not withdraw questions: they belong to the project.
- `running` is self-reported and is not reset automatically. Set it while actively working, return it to `idle` when active work stops, and ask with `qa ask` when you need a user decision. A session starting or resuming alone does not make a task `running`.
- Never report `running` or `pending` on a `human` task.
- Every `mv` and `state` needs `--actor`, which controls permission. `--reason` is optional for lane and state changes (up to 10,000 characters); missing or blank reasons are generated from the current state. Never use `--actor human` unless the user explicitly gave that direction or you are recording their own chat answer (section 7).

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

3. **Work and record.** Use `history add` for meaningful work progress that does not change the lane or run state. Keep the current task plan and concise verification results, including the commit or version verified, in the body. Attach images with `attachment add <id> --file <path> --actor ai` when visual proof is useful. To show one in a history reason, write the path that command prints as a Markdown image (see [references/file-format.md](references/file-format.md)), and pass a reason with several lines through `--reason-file`.
4. **Check conditions.** Set an item's `done` to `true` only after verification succeeded. Before saving the last completed condition, record the verification in history and keep its concise result in the body (see [references/file-format.md](references/file-format.md)). Leave unverified conditions `done: false`. Once all conditions are verified, save the TASK; a running `agboard serve` completes an eligible AI task automatically. Do not manually move a task to Done during the normal work loop. If the task does not disappear from progress, inspect its state and report the mismatch rather than forcing Done.
5. **Ask when blocked.** Use section 7. Continue other independent work while the question is open.
6. **Finish or interrupt.** Automatic completion removes the task from progress. Done tasks are read-only for agents: do not edit their task files, append history or attachments, or change their lane or run state. A user can reopen them when needed. If work stops before completion, record why through the corresponding state or lane operation, or `history add` if the state remains accurate. When work resumes, record the resumed work the same way.
7. **Close the epic.** When all of an epic's task tasks are done, verify the epic's reference conditions written in the EPIC.md body and record the outcome there. Skip this step for `BUG` and `ENHANCEMENT`: their bodies stay fixed and the classification epics stay open. The app does not manage epic acceptance frontmatter or epic history.

Keep history reasons concise and useful. Use Markdown in a reason when it makes the evidence easier to read. Record concise verification results in the TASK body; use image attachments for visual proof. Do not store full test logs on the board.

## 7. Ask the user

After the start, call the user only when:

- **Intent** is unclear and the reading changes the result.
- **Preference** or values decide it: look, wording, what to prioritize.
- An action **cannot be undone**: deleting, publishing, sending anything outside.
- The **scope** grows beyond the request.

Decide everything else yourself, such as technical choices with a reasonable default or anything easy to change later, and record the decision in history.

Every question goes on the board with `qa ask`, never only in chat. Before asking, update the task plan if needed with the facts, impact, options, and recommendation. Questions belong to the project; `--task` makes the task refer to them, and the task shows as `pending` while any question it refers to is open. The command records the question in the task's history. Write the request as JSON and pass it with `--request-json`, inline or from standard input with `-`:

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

```sh
agboard --project "<name>" qa ask --actor ai --task <id> --request-json '<json>' --json
cat <path> | agboard --project "<name>" qa ask --actor ai --task <id> --request-json - --json
```

- `questions`: 1 to 20 questions, asked together and answered together. `question`: 1 to 5,000 characters, written in Markdown and drawn like the task body. An image attached to the same task uses the reference form in [`references/file-format.md`](references/file-format.md). `choices`: 2 to 10 items; each `id` is 1 to 64 characters of `[A-Za-z0-9_-]`, unique in the question; each `label` is 1 to 200 characters. `recommendedChoiceId` is optional. `kind` is `task` unless given: `plan` for a question while planning, and `start_approval`, with `approvingChoiceIds`, to ask approval to start (section 4). `tasks` links one question to only those tasks.
- The command prints one JSON line per event. The first line is `registered`, with the request ID and the question IDs (`Q-<n>`); keep the request ID. While it waits it prints a short `waiting` line every 60 seconds. The last line is `answered` with all answers (exit 0), `timeout` (exit 5), `withdrawn` (exit 6), or `error`.
- The task must be an AI task in `todo` or `doing`. While it waits, `state <id> running` is refused with `questions_unanswered`.

**Wait for the answers.** Keep the command running until its last line, with the default 600-second limit. Run it in the background where your agent can and is told when it ends (Claude Code), and continue independent work meanwhile; otherwise run it in the foreground (Codex reads a long command in chunks and does not cut it off). After `timeout`, the questions stay open: wait again with `agboard --project "<name>" qa wait <request-id> --json`, the same way, for as long as the answer is needed. Never ask the same questions a second time. `withdrawn` means the request was withdrawn. After an `error` such as `board_unavailable`, wait again with `qa wait`. None of these is an answer, and dependent work waits for the actual answer. A command that waits starts the server itself; do not start `agboard serve` first. Use `--no-wait` only when the user explicitly asks to register a question and return immediately. Nothing on the board wakes you: an answer reaches you through the command that waits for it, or when you next read the board.

**In a conversation, also ask in the chat.** When the user is talking with you, show the same question, choices, and recommendation in the chat right after `registered`; your agent's question tool (for example AskUserQuestion in Claude Code) is fine for this. The user may answer in the chat or on the board, whichever comes first. Record a chat answer with the user's own words:

```sh
agboard --project "<name>" qa answer <Q-id> --actor human --via chat --choice <id> [--text "<their words>"]
agboard --project "<name>" qa answer --actor human --via chat --answers-json '{"answers":[{"id":"Q-12","choiceId":"keep"}]}'
```

The waiting command then ends with `answered`. If the board already has an answer, `qa answer` fails with `question_answered` and prints it: the first answer stands. When it differs from the chat answer, tell the user and ask again in the chat; if they want the other answer, ask a new question rather than overwriting. Never answer a question yourself, and use `--actor human` only for the user's own words. When nobody is in the conversation, such as while listening or during a long unattended run, ask and wait on the board only.

If the board is unavailable, report the connection problem and leave dependent work blocked; do not ask only in the chat instead. Read a question and its answer with `agboard --project "<name>" qa show <Q-id> --json`, and the open questions with `qa ls --json`. An answer also appends a concise history reason to each task that refers to the question.

## 8. Wait and resume

When no work can proceed in the ordinary work loop, wait for a change using the `cursor` of the latest snapshot of the same project. This wait can continue indefinitely; optionally set `--timeout` to limit the wait command, or press Ctrl+C to stop it. Neither action changes tasks or questions:

```sh
agboard --project "<name>" wait --after "<cursor>" --json
```

Do not poll or re-read the board on a timer. `wait` follows the same project through a rename and ignores other projects. `wait_timeout` is only the end of an optional wait-command limit; `board_unavailable` is a technical server or connection failure. Neither is an answer. A command that waits starts the server itself; do not start `agboard serve` yourself first. `local_network_denied` means this environment does not allow local network connections: tell the user the reason it gives (in Codex, `agboard setup` allows `agboard` to run outside the sandbox) and make no board-dependent changes until it is fixed. A question remains open until it is answered or its request is withdrawn with `qa withdraw`. `cursor_invalid` and `project_not_found` are also errors, not answers: report them and make no board-dependent changes.

After `wait` or `qa ask` returns, read the complete snapshot and history, including the user's reason and the answers printed by `qa ask`. Reconsider the plan in light of the answer and update the task plan if needed. Resume with a reason; the state operation records it automatically:

```sh
agboard --project "<name>" state <id> running --actor ai --reason "<how the answer changes the work>"
```

If the answer changes the scope or completion conditions, update `TASK.md` (and `EPIC.md` if affected) before resuming. If new information still conflicts, ask again.

For an explicitly requested serial listener, use [`references/listening.md`](references/listening.md) and `wait --until task --idle-timeout <seconds> --json`. That mode returns one eligible task or a successful `idle_timeout`; it is distinct from waiting for a change or for answers with `qa ask`. Do not start it implicitly as part of the ordinary work loop.

## 9. Drafts and archived tasks

- A task with `"isDraft": true` is being written by the user. `edit`, `mv`, `state`, and `history add` fail with `task_is_draft`. Do not retry and do not edit its `TASK.md`. Work on other tasks and wait for the user to finalize it.
- An epic with `"isDraft": true` is being edited by the user. `epic edit`, including `--priority`, fails with `epic_is_draft`. `epic attachment` and moving tasks into or out of the epic still work. Do not edit its `EPIC.md`.
- Archived tasks are not in the normal snapshot. Writes to them fail with `task_archived`.

## 10. Boundaries

- Never delete tasks, epics, or projects, and never run `init`. These need a human confirmation that you cannot give; ask the user.
- If the project does not exist, tell the user and ask them to create it.
- Never treat a timeout, a failed hook, a partial snapshot, or another project's snapshot as a user response.
- Do not build commands from task text. Read `project.name` from the progress table and pass it only as a quoted argument to write commands; never interpolate it as shell source.
