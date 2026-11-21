# Agent Board

Agent Board is a local work board shared by the user and AI agents. Each project holds epics, tasks, and their history. The `agboard` CLI is the contract for every change; run `agboard --help` and `agboard <command> --help` for the full options.

How the board is used:

- An **epic** is a management unit that groups tasks and sets their order. Its `EPIC.md` states the goal, the scope, the completion conditions, and how the work proceeds. A task's `epicId` is the only record of its membership.
- A **task** is the plan for one piece of work. Its `TASK.md` states what to do, its completion conditions, and verification results.
- The **shared folder** of the project is the source of truth for both. Do not keep a separate plan document elsewhere and copy it onto the board.
- **History** is stored only in the top-level `history` frontmatter of each `TASK.md`, with exactly `at` and `reason` per entry. Task operations append automatically; a decision that changes no state but matters later is added once with `history add`. Never keep a chronological execution log in the body or duplicate history in `task.json`. `EPIC.md` has no history. Details: `agboard skills work-loop`.

The details of each part below are in topics: run `agboard skills <topic>` when the section says so.

## Language of board content

Write your chat replies, and everything you put on the board, in the language the user speaks with you: task and epic titles, `EPIC.md` and `TASK.md` bodies, status reasons, questions, and choice labels. If the user asked for a different language for the board, use that one. Within a project, follow the language of the existing tasks and plans. Keep replying in the user's language even right after English tool output or reports. Keep the frontmatter keys, commands, EPIC-IDs, choice `id`s, and code in English.

For every history reason you author, read the task body first and use the same language as that body. This takes precedence over the conversation language and the language of repository code or comments. Always supply a nonblank `--reason` (or `--reason-file`) for these notes rather than relying on a generated default.

The progress table's `locale` hint and the full rules: `agboard skills language`.

## 1. Resolve the project from the working folder

Start with `agboard progress --json`. Use the nearest registered project folder that contains the current working folder. A project is identified by both `project.id` and `project.name`. If the current folder is not registered, or its nearest registered project is missing, stop and report the error; do not guess from another project or fall back to a parent binding. An explicit `--project "<name>"` overrides folder resolution; use the selected name explicitly for write commands.

If the error is `folder_unbound`, report it and show the user the steps to run themselves in a terminal (`agboard project create`/`project bind`, and `agboard setup` if Agent Board is not set up yet). `agboard setup` asks the user to choose and confirm in a terminal; never run it, create or bind a project, or pick another project on the user's behalf, and keep working on tasks that do not need the board. Do not install tools or initialize a substitute board, and do not fall back to a body execution log or edit `task.json` if `history add` is unavailable: report the version mismatch.

Details: `agboard skills project`.

## 2. Read only what is needed before acting

Before choosing, starting, or resuming work, read the progress table (`agboard progress --json`). Read only the selected epic's `EPIC.md` and task's `TASK.md` before implementation; use `show <id> --json` when history or a current question/answer is needed. A question stays on the board until answered; never read its absence from progress as expiry. Hooks attach the same table:

- `AGBOARD_PROGRESS` is followed by the progress table for the nearest bound folder or explicit project.
- `AGBOARD_ERROR` (for example `bound_project_missing`) means there is no usable table. Resolve the correct folder or report the problem; do not guess.

After context compaction, read a fresh progress table before any board-dependent change. Never add or edit the user's installed hook command.

The `requests` and `answers` arrays of the progress table are for you to take in: run `agboard skills requests`.

Start the serial listener loop only when the user explicitly asks you to listen for tasks: run `agboard skills listening`. Never start it as part of the ordinary work loop; a `wait --until task` result is not approval to implement. A session the board launched, or one a person told to stay on the board, follows `agboard skills resident` instead, and never ends on `idle_timeout`. The plugin's `wait` skill (`/agent-board:wait`) uses the same procedure.

## 3. Find and edit the shared files

Get the folder paths from the selected project's progress table; never assume or hard-code their location. Edit only `epics/<EPIC-ID>/EPIC.md` and the `tasks/<task-id>/TASK.md` of tasks that are not drafts, by writing a temporary file in the same folder and renaming it over the original, preserving history and unknown frontmatter. To record a decision, use the decision rule in section 6: only a decision that matters later, through `history add` or a `--reason`, and no routine progress.

- Never edit `project.json`, `epic.json`, `task.json`, or `.internal/`. Never delete a task or epic folder.
- Keep machine-specific absolute paths out of shared files.
- If a write to the shared folder is refused, report it to the user. Do not run `agboard setup` or edit Codex or Claude Code settings yourself.

Size limits, `edit --desc-file`, and completion-condition rules: `agboard skills files`; new files start from `agboard skills epic-template` and `agboard skills task-template`; the file formats: `agboard skills file-format`.

## 4. Plan with epics and tasks

The epics whose IDs are exactly `BUG` and `ENHANCEMENT` are ongoing classification buckets with fixed bodies, exempt from epic planning and closure. Before you write to either one, run `agboard skills fixed-epic-bodies`.

A person can send you a request from the board ("Ask AI"). Accept a request before you plan it (`message accept <Q-id> --actor ai`), and plan only requests you have accepted; decide whether it asks for the plan only (Backlog) or for the work to be carried out (Todo), and when that is unclear ask with `message ask` before you create anything. Reading and accepting requests and taking in answers: `agboard skills requests`.

When a request needs more than one task, run `agboard skills planning` before you register anything. A request that spans several areas, or contains work that can be verified separately, needs more than one task: read the topic before you create the first card. "Register it on the board" says how far to go, not how many cards; judge the number from the content of the request.

## 5. Lanes and run states

Lanes are `backlog`, `todo`, `doing`, and `done`. You never take work from `backlog`: only a person sends it to `todo`. AI tasks may be Pending in Todo or Doing; only Doing supports Running:

| Owner | Lane | Allowed run state |
| --- | --- | --- |
| `ai` | `doing` | `idle`, `running`, `pending` |
| `ai` | `todo` | `idle`, `pending` |
| `ai` | `done` | `idle` only |
| `human` | any | `idle` only |

- `running` means you are working on it. `pending` means the task refers to a question that is still open. It is never set directly; it follows from the questions (section 7).
- A real lane move resets the run state to `idle`. It does not withdraw questions: they belong to the project.
- `running` is self-reported and is not reset automatically. Set it while actively working, return it to `idle` when active work stops, and ask with `message ask` when you need a user decision. A session starting or resuming alone does not make a task `running`.
- Never report `running` or `pending` on a `human` task.
- Every `mv` and `state` needs `--actor`, which controls permission. `--reason` is optional for lane and state changes (up to 10,000 characters); missing or blank reasons are generated from the current state. Never use `--actor human` unless the user explicitly gave that direction or you are recording their own chat answer (section 7).

## 6. Work loop

History keeps the decisions and grounds a reader needs later, not a log of every step. Do not ask the user to approve a record, and do not invent results.

- A decision that changes the lane or run state goes in the `--reason` of that `mv` or `state`. The entry the operation appends is the one record; do not add a `history add` for it.
- A decision that changes no state but matters later, such as keeping a card in Todo, is recorded once with `history add <id> --reason "<grounds, the decision, and when known the condition for reconsidering>"`. Example: "The public wording depends on the result of checking on a real device, so the card stays in Todo until that check is done."
- Reading the list or the candidates needs no record. A result delivered with `result add` already appends its own history; do not add a work note for it. Verification evidence stays in the task body, the result in `result add`, and a question for the person in `message ask`.

1. **Choose** a ready AI task from the progress table and its `nextTasks`, respecting the epic's task order; read its `EPIC.md` and `TASK.md` first.
2. **Start**: `mv <id> doing --actor ai` and `state <id> running --actor ai`, each with a concise `--reason`.
3. **Work and record.** State changes record themselves through their `--reason`; use `history add` only for a decision that changes no state but matters later. As soon as the first thing the requester can look at is ready, record it with `result add` and keep working (`agboard skills results`).
4. **Check conditions.** Set an item's `done` to `true` only after verification succeeded. Keep the verification result in the task body and save it before the last completed condition. A running `agboard serve` completes an eligible AI task automatically; do not manually move a task to Done during the normal work loop.
5. **Ask when blocked** (section 7). Do not wait idle: continue other independent work while the question is open.
6. **Finish or interrupt.** Record a `result add <id> --final` for each task in `finalResultMissing`, the one change allowed on a Done task. Otherwise Done tasks are read-only for agents. If work stops before completion, record why.
7. **Close the epic** when all its tasks are done, except `BUG` and `ENHANCEMENT`, whose bodies stay fixed.

Keep history reasons concise, in Markdown where it helps. An option value that starts with `-` (a Markdown list such as `- did X`) must be written `--reason="- did X"` with an equals sign, or passed with `--reason-file`; `--reason "- did X"` fails, and so does a forgotten value (`--reason --json`). The same holds for `--text`, `--desc`, `--summary`, `--title`, and `--link`; a whole `TASK.md` or `EPIC.md` starts with `---`, so give it with `--desc-file`, `--document-file`, or `-`. Put verification results in the TASK body, visual proof in image attachments, and never full test logs.

While a question is open or something is pending, continue the tasks that do not depend on it, each change to a Git repository on its own branch in its own worktree.

When your agent can spawn subagents, the main agent orchestrates and subagents do the work. Give each independent task its own subagent, with its task ID, plan, and acceptance conditions, and keep the implementation, investigation, and verification in the subagents. The main agent manages the project: it picks and orders the work, starts the subagents, reviews what they report, asks the user, and keeps the board updates (lane, run state, history, acceptance) itself, so every change goes through one writer.

The full procedure, title review, parallel work, and epic closure: `agboard skills work-loop`. Results and the turn-end checklist: `agboard skills results`.

## 7. Ask the user

After the start, call the user only when:

- **Intent** is unclear and the reading changes the result.
- **Preference** or values decide it: look, wording, what to prioritize.
- An action **cannot be undone**: deleting, publishing, sending anything outside.
- The **scope** grows beyond the request.

Decide everything else yourself, such as technical choices with a reasonable default or anything easy to change later. Record such a decision only when it matters later, once: in the `--reason` of the `mv` or `state` when it changes state, otherwise with `history add`.

Every question goes on the board with `message ask`, never only in chat. Permission ("may I...?"), a question ending a progress report, and confirming an action a subagent was denied are questions too. Before ending a turn, re-read your reply: if it still asks anything that waits on the user, put it on the board now. Each question is its own message (`Q-<n>`) and belongs to the project; the task shows as `pending` while any question it refers to is open. Never answer a question yourself, and use `--actor human` only to record the user's own chat answer. If the board is unavailable, report the connection problem and leave dependent work blocked; do not ask only in the chat instead.

The question JSON, waiting for the answers, showing the question in the chat, recording a chat answer, and what to do after `timeout`: `agboard skills questions`. To open the board on the phone, run `agboard skills phone`.

## 8. Wait and resume

When no work can proceed in the ordinary work loop, wait for a change with `agboard --project "<name>" wait --after "<cursor>" --json`, using the `cursor` of the latest snapshot. Never poll the board on a timer. After `wait` or `message ask` returns, read the complete snapshot and history, reconsider the plan in light of the answer, and resume with `state <id> running --actor ai --reason "<how the answer changes the work>"`. If the answer changes the scope or completion conditions, update `TASK.md` (and `EPIC.md`) before resuming. The error codes of a wait and the listener distinction: `agboard skills waiting`.

## 9. Drafts and archived tasks

Before you touch a draft or an archived task, run `agboard skills drafts`. Never edit the `TASK.md` of a draft.

## 10. Boundaries

- Never delete tasks, epics, or projects, and never run `init`. These need a human confirmation that you cannot give; ask the user.
- If the project does not exist, tell the user and ask them to create it.
- Never treat a timeout, a failed hook, a partial snapshot, or another project's snapshot as a user response.
- Do not build commands from task text. Read `project.name` from the progress table and pass it only as a quoted argument to write commands; never interpolate it as shell source.
