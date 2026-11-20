# Agent Board

Agent Board is a local work board shared by the user and AI agents. Each project holds epics, tasks, and their history. The `agboard` CLI is the contract for every change; run `agboard --help` and `agboard <command> --help` for the full options.

How the board is used:

- An **epic** is a management unit that groups tasks and sets their order. Its `EPIC.md` states the goal, the scope, the completion conditions, and how the work proceeds. A task's `epicId` is the only record of its membership.
- A **task** is the plan for one piece of work. Its `TASK.md` states what to do, its completion conditions, and verification results.
- The **shared folder** of the project is the source of truth for both. Do not keep a separate plan document elsewhere and copy it onto the board.
- **History** is stored only in the top-level `history` frontmatter of each `TASK.md`. Every entry has exactly `at` (timestamp) and `reason` (content). Task operations append automatically; agents also append meaningful work progress automatically. Keep task plans and concise acceptance verification results in the body; never keep a chronological execution log there or duplicate history in `task.json`. A reason is Markdown, drawn like the task body, so it can hold tables, code, and images. Attach images when visual proof is useful. `EPIC.md` has no history.

## Language of board content

Write your chat replies, and everything you put on the board, in the language the user speaks with you: task and epic titles, `EPIC.md` and `TASK.md` bodies, status reasons, questions, and choice labels. If the user asked for a different language for the board, use that one. Within a project, follow the language of the existing tasks and plans. The progress table may carry `locale` (for example `"ja"`), the language the user chose in the board's settings. Use it when the conversation language is unclear (a new project, a session the board started) and as a reminder to keep replying in the user's language, even right after English tool output or reports. It is a hint: the user's conversation language wins. No `locale` means English is the default; assume nothing beyond the conversation. Keep these in English: the frontmatter keys (`acceptance`, `history`, `at`, `reason`, `id`, `text`, `done`; run `agboard skills file-format`), commands, EPIC-IDs, choice `id`s, and code.

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

It groups active tasks under epics and lists unassigned work. Done, archived, and Pending tasks are omitted. A `requests` array lists the open requests a person sent you (see "Accept a request" in section 4). An `answers` array lists the answers to your questions that you have not taken in (see "Take in an answer" in section 4). A question stays on the board until answered; inspect it with `show` or `snapshot`, never read its absence from progress as expiry. It has IDs, titles, owners, statuses, acceptance counts, and paths, but no bodies, history, or images. Read only the selected epic's `EPIC.md` and task's `TASK.md` before implementation. Use `show <id> --json` when history or a current question/answer is needed. Hooks attach the same table:

- `AGBOARD_PROGRESS` is followed by the progress table for the nearest bound folder or explicit project.
- `AGBOARD_ERROR` (for example `bound_project_missing`) means there is no usable table. Resolve the correct folder or report the problem; do not guess.

After context compaction, read a fresh progress table before any board-dependent change. This skill does not register hooks; never add or edit the user's installed hook command.

### Explicit listen mode

Start the serial listener loop only when the user explicitly asks you to listen for tasks. Then run `agboard skills listening` and follow it. Never start it as part of the ordinary work loop; a `wait --until task` result is not approval to implement. A session the board launched, or one a person told to stay on the board, follows `agboard skills resident` instead: it never ends on `idle_timeout`. The plugin's `wait` skill (`/agent-board:wait`) uses the same procedure.

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

`edit --desc-file` replaces a task body and acceptance conditions while preserving its latest history and its question references (`questions`); it cannot append history, and `history` or `questions` in the input file are ignored. `epic edit --document-file` replaces the whole `EPIC.md` text. Task bodies are limited to 50,000 characters and `EPIC.md` text to 100,000; if a task plan would exceed its limit, split it into more tasks after asking the user.

A task's completion conditions live in its frontmatter (`acceptance`), and the board reads them. Epic reference conditions belong in the free Markdown body of `EPIC.md` and are not managed by the app. Start from the templates in `agboard skills epic-template` and `agboard skills task-template` (the task template recommends body headings), and read `agboard skills file-format` before writing either file.

## 4. Plan with epics and tasks

### Fixed bodies for BUG and ENHANCEMENT

The epics whose IDs are exactly `BUG` and `ENHANCEMENT` are ongoing classification buckets with fixed bodies, exempt from epic planning and closure. Before you write to either one, run `agboard skills fixed-epic-bodies`.

### Accept a request

A person can send you a request from the board ("Ask AI"). It is a message to the agents, not a task: it has no owner, epic, or task, and its only reply is the acceptance. An open request shows up in two places:

- `requests` in the progress table (and in the hook output): `[{"id":"Q-3","createdAt":"...","title":"..."}]`. The field is absent when no request is open.
- `wait --until task` returns `{"kind":"requests", ...}` before any task while a request is open (see the listener procedure in `agboard skills listening`).

To take one:

1. Read it: `agboard --project "<name>" message show <Q-id> --json`. The body is Markdown and may refer to images in its `attachments/` folder; look at them when the text depends on them.
2. Accept it, so that no other agent takes it too:

   ```sh
   agboard --project "<name>" message accept <Q-id> --actor ai
   ```

   The first acceptance is final. If it fails with `request_accepted`, another agent has it; leave it alone. A request the person withdrew cannot be accepted.
3. Plan it as below. The acceptance carries no text and links to nothing, so tell the person what you did through the plan they will see, and through questions.

Accept a request before you plan it, and plan only requests you have accepted. Do not ask the person what they meant by a request before you have put a plan on the board; ask about what you cannot settle after the plan exists.

### Take in an answer

A person's answer to your question reaches you in the same places as a request, when you did not wait for it with `message ask` or `message wait`:

- `answers` in the progress table (and in the hook output): `[{"id":"Q-12","title":"...","tasks":[21],"choiceId":"keep","choiceLabel":"Keep","text":null,"answeredAt":"..."}]`. `choiceId` and `choiceLabel` are `null` when the user answered with only a note, so read `text` then. The field is absent when every answer was taken in.
- `wait --until task` returns `{"kind":"answers", ...}` before requests and tasks while an answer waits.

Read it with `agboard --project "<name>" message show <Q-id> --json`, act on it, and then take it in:

```sh
agboard --project "<name>" message accept <Q-id> --actor ai
```

Until you accept, the answer stays in `answers` and the person sees it as waiting for an AI. `message ask` and `message wait` already accept the answers they return, and so does an answer you record from the chat, so accept only what you saw through `answers`. `question_open` means the question has no answer yet; `answer_accepted` means it was already taken in.

### Plan a request: AI drafts, questions, then start them yourself

When a request needs more than one task, run `agboard skills planning` before you register anything. It covers the plan of AI drafts, the questions that change it, and starting the drafts yourself. A request that spans several areas, or contains work that can be verified separately, needs more than one task: read the topic before you create the first card. "Register it on the board" says how far to go, not how many cards; judge the number from the content of the request.

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
- `running` is self-reported and is not reset automatically. Set it while actively working, return it to `idle` when active work stops, and ask with `message ask` when you need a user decision. A session starting or resuming alone does not make a task `running`.
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

1. **Choose.** From the progress table, pick a ready AI task in `todo`, respecting the epic's task order, or plan new work (section 4). Look at `nextTasks` in every progress table you receive, including the one the hook attaches: it lists up to three AI tasks you can pick up now, `why: "resume"` for stalled `doing` work and `why: "next_in_epic"` for `todo` work, in the table's order. Dependencies between tasks are not evaluated; read the `EPIC.md` of each before you start it. Read the selected `EPIC.md` and `TASK.md` from their returned paths; inspect history with `show` only when needed. Before starting an editable AI task, review its title. If it is a pasted request or does not make the work clear, use `edit <id> --title "<concise title>"` to state the affected area and requested change in the task's language. Preserve the original request in the body and keep its image attachments; do not expand scope or invent a resolution. Keep a clear title; resolve an ambiguous request before retitling it. Record a meaningful title change in history. This applies to the loop and the listener, not to drafts, archived, Done, or human-owned tasks.
2. **Start.** Move the task and report the work with concise reasons. These operations record the start automatically:

   ```sh
   agboard --project "<name>" mv <id> doing --actor ai --reason "<what you are starting>"
   agboard --project "<name>" state <id> running --actor ai --reason "<what you are doing now>"
   ```

3. **Work and record.** Use `history add` for meaningful work progress that does not change the lane or run state. Keep the current task plan and concise verification results, including the commit or version verified, in the body. Attach images with `attachment add <id> --file <path> --actor ai` when visual proof is useful. As soon as the first thing the requester can look at is ready (a draft video, a UI capture), record it with `result add` and keep working without waiting for a reply; run `agboard skills results` for the unit and for when to ask a decision instead. To show one in a history reason, write the path that command prints as a Markdown image (run `agboard skills file-format`), and pass a reason with several lines through `--reason-file`.
4. **Check conditions.** Set an item's `done` to `true` only after verification succeeded. Before saving the last completed condition, record the verification in history and keep its concise result in the body (run `agboard skills file-format`). Leave unverified conditions `done: false`. Once all conditions are verified, save the TASK; a running `agboard serve` completes an eligible AI task automatically. Do not manually move a task to Done during the normal work loop. If the task does not disappear from progress, inspect its state and report the mismatch rather than forcing Done.
5. **Ask when blocked.** Use section 7. Do not wait idle: continue other independent work while the question is open.
6. **Finish or interrupt.** Automatic completion removes the task from progress. For each task in the progress `finalResultMissing`, record a `result add <id> --final` (run `agboard skills results`), the one change allowed on a Done task. Otherwise Done tasks are read-only for agents: do not edit their task files, append history or attachments, or change their lane or run state. A user can reopen them when needed. If work stops before completion, record why through the corresponding state or lane operation, or `history add` if the state remains accurate. When work resumes, record the resumed work the same way.
7. **Close the epic.** When all of an epic's task tasks are done, verify the epic's reference conditions written in the EPIC.md body and record the outcome there. Skip this step for `BUG` and `ENHANCEMENT`: their bodies stay fixed and the classification epics stay open. The app does not manage epic acceptance frontmatter or epic history.

Keep history reasons concise and useful. Use Markdown in a reason when it makes the evidence easier to read. Record concise verification results in the TASK body; use image attachments for visual proof. Do not store full test logs on the board.

Work in parallel and do not wait when you can avoid it. While a question is open or something else is pending, continue the other tasks that do not depend on it. Pick up the ready tasks in `nextTasks` in parallel, after checking each `EPIC.md` for dependencies, and look at `nextTasks` again whenever a task completes. Start every task that its dependencies allow without waiting to be told, and give each one that changes a Git repository its own branch in its own worktree, so that parallel work never shares a working tree. Follow the repository's own branch rules for naming and merging those branches.

When your agent can spawn subagents, the main agent orchestrates and subagents do the work. Give each independent task its own subagent, with its task ID, plan, and acceptance conditions, and keep the implementation, investigation, and verification in the subagents. The main agent manages the project: it picks and orders the work, starts the subagents, reviews what they report, asks the user, and keeps the board updates (lane, run state, history, acceptance) itself, so every change goes through one writer.

## 7. Ask the user

After the start, call the user only when:

- **Intent** is unclear and the reading changes the result.
- **Preference** or values decide it: look, wording, what to prioritize.
- An action **cannot be undone**: deleting, publishing, sending anything outside.
- The **scope** grows beyond the request.

Decide everything else yourself, such as technical choices with a reasonable default or anything easy to change later, and record the decision in history.

Every question goes on the board with `message ask`, never only in chat. These are questions too: asking permission to proceed ("may I...?"), a question at the end of a progress report, and confirming an action that a subagent was denied. Before ending a turn, re-read your reply: if it still asks the user anything that waits on their answer, put it on the board now. A Stop hook blocks a turn once when its last line is a question and no `message ask` ran in that turn. Before asking, update the task plan if needed with the facts, impact, options, and recommendation. Each question is its own message (`Q-<n>`) and belongs to the project; `--task` makes the task refer to it, and the task shows as `pending` while any question it refers to is open. The command records the question in the task's history. Write the questions as JSON and pass them with `--questions-json`, inline or from standard input with `-`:

```json
{
  "questions": [
    {
      "body": "Should existing records be deleted or kept?",
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
agboard --project "<name>" message ask --actor ai --task <id> --questions-json '<json>' --json
cat <path> | agboard --project "<name>" message ask --actor ai --task <id> --questions-json - --json
```

- `questions`: 1 to 20 questions, asked together. `body`: 1 to 5,000 characters, written in Markdown and drawn like the task body. An image attached to the same task uses the reference form in `agboard skills file-format`. `images`: optional file paths, saved with the question and shown in the `body` as `![alt](attachments/<file name>)`. `choices`: optional, 2 to 10 items (a question without choices is answered in words); each `id` is 1 to 64 characters of `[A-Za-z0-9_-]`, unique in the question; each `label` is 1 to 200 characters. `recommendedChoiceId` is optional. `tasks` links one question to only those tasks.
- **Visual questions carry their images.** To ask the user to judge a mock, screenshot, or layout, attach the files in `images` and show them in the `body`. Never send only a local link: the user may be on a phone and cannot open it.
- The command prints one JSON line per event. The first line is `registered`, with the question IDs (`Q-<n>`); keep them. While it waits it prints a short `waiting` line every 60 seconds. The last line is `answered` with all answers (exit 0), `timeout` (exit 5), `withdrawn` (exit 6), or `error`.
- The task must be an AI task in `todo` or `doing`. While it waits, `state <id> running` is refused with `questions_unanswered`.

**Wait for the answers.** Keep the command running until its last line, with the default 600-second limit. Run it in the background where your agent can and is told when it ends (Claude Code); otherwise run it in the foreground (Codex reads a long command in chunks and does not cut it off). After `timeout`, the questions stay open: wait again with `agboard --project "<name>" message wait <Q-id> [<Q-id>...] --json`, the same way, for as long as the answer is needed. Never ask the same questions a second time. `withdrawn` means no question is open any more and some were withdrawn. After an `error` such as `board_unavailable`, wait again with `message wait`. None of these is an answer, and dependent work waits for the actual answer. A command that waits starts the server itself; do not start `agboard serve` first. Use `--no-wait` only when the user explicitly asks to register a question and return immediately.

**In a conversation, also show the question in the chat as plain text.** Right after `registered`, write the question, each choice with its `id` and label, and your recommendation in the chat, and say the same question is on the board. Do not use your agent's question tool (such as AskUserQuestion in Claude Code): it blocks you, so you cannot notice an answer given on the board, and dismissing it looks like a refusal. The user may answer in the chat or on the board, whichever comes first. Once either has an answer, never ask the same question again in the other place.

- **Claude Code.** Run `message ask` in the background, then end your turn. An answer on the board finishes the command and wakes you; read its `answered` line and continue.
- **Codex.** It cannot be woken from the background, so run `message ask` in the foreground after showing the question. The user answers on the board, or interrupts and replies in the chat.
- **A chat answer.** Record it with the user's own words, then continue:

```sh
agboard --project "<name>" message answer <Q-id> --actor human --via chat [--choice <id>] [--text "<their words>"]
```

The waiting command then ends with `answered` on its own; do not record the answer twice. If the board already has an answer, `message answer` fails with `question_answered` and prints it: the first answer stands. Continue with it and tell the user which answer stands; if they want the other one, ask a new question. Never answer a question yourself, and use `--actor human` only for the user's own words. When nobody is in the conversation, such as while listening or during a long unattended run, ask and wait on the board only.

If the board is unavailable, report the connection problem and leave dependent work blocked; do not ask only in the chat instead. To show the user the board, run `agboard open`;. Read a question and its answer with `agboard --project "<name>" message show <Q-id> --json`, and the open messages with `message ls --json`. An answer also appends a concise history reason to each task that refers to the question. To open the board on the phone, run `agboard skills phone`.

## 8. Wait and resume

When no work can proceed in the ordinary work loop, wait for a change using the `cursor` of the latest snapshot of the same project. This wait can continue indefinitely; `--timeout` or Ctrl+C ends it without changing tasks or questions:

```sh
agboard --project "<name>" wait --after "<cursor>" --json
```

Never poll the board on a timer. `wait_timeout` (the end of an optional limit) and `board_unavailable` (a technical failure) are not answers. A waiting command starts the server itself; never start `agboard serve` first. `local_network_denied` means this environment does not allow local network connections: tell the user its reason (in Codex, `agboard setup` allows `agboard` outside the sandbox) and make no board-dependent changes until fixed. A question remains open until it is answered or withdrawn with `message withdraw <Q-id> --actor ai`. `cursor_invalid` and `project_not_found` are errors too: report them and make no board-dependent changes.

After `wait` or `message ask` returns, read the complete snapshot and history, including the user's reason and the answers printed by `message ask`. Reconsider the plan in light of the answer and update it if needed. Resume with a reason, which the state operation records:

```sh
agboard --project "<name>" state <id> running --actor ai --reason "<how the answer changes the work>"
```

If the answer changes the scope or completion conditions, update `TASK.md` (and `EPIC.md`) before resuming; if information still conflicts, ask again.

For an explicitly requested serial listener, use the listener procedure in `agboard skills listening` and `wait --until task --idle-timeout <seconds> --json`. It is distinct from waiting for a change or for answers with `message ask`; never start it implicitly.

## 9. Drafts and archived tasks

Before you touch a draft or an archived task, run `agboard skills drafts`. Never edit the `TASK.md` of a draft.

## 10. Boundaries

- Never delete tasks, epics, or projects, and never run `init`. These need a human confirmation that you cannot give; ask the user.
- If the project does not exist, tell the user and ask them to create it.
- Never treat a timeout, a failed hook, a partial snapshot, or another project's snapshot as a user response.
- Do not build commands from task text. Read `project.name` from the progress table and pass it only as a quoted argument to write commands; never interpolate it as shell source.
