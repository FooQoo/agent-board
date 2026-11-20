# History and decisions

How Agent Board records what happened (history), asks people for decisions (project questions and their answers), and decides when a task is finished (acceptance conditions and automatic Done).

## Messages

Messages belong to the project, not to a task. A message is a question from an agent to a person, or a request from a person to an agent. Tasks refer to the questions they wait on.

- Each message is one file, `qa/Q-<n>/QA.md`: YAML frontmatter plus a Markdown body. Images attached to a request, or to a question with `images` in `message ask`, live in `qa/Q-<n>/attachments/`. `ask` writes the question files first and then moves the staged image folder under each question with one rename. Questions and requests share one number sequence, `nextQuestionId` in `project.json`; numbers only grow.
- A question has `from` and `to`, an optional `tasks` list (the tasks it was asked for), 2 to 10 optional `choices`, an optional `recommended` choice, a `reply`, `withdrawnAt`, and `createdAt`. The body is the question, 1 to 5,000 characters. Each choice has an ID unique within the question (1 to 64 characters of `[A-Za-z0-9_-]`) and a label of 1 to 200 characters. `recommended` must name a choice.
- A request has `from`, `to`, `acceptedAt`, `withdrawnAt`, and `createdAt`. The body is the request, 1 to 20,000 characters.
- `agboard message ask` writes one question file per question, up to 20 per call. `--task <id>`, or `tasks` on a question, adds the question ID to the task's `questions` frontmatter and appends history with the question and its choices as separate blocks. A Running task returns to Idle in the same save. The tasks must exist, be unarchived, not be drafts, and, for an AI actor, not be Done; otherwise nothing is written.
- A reply is `{choice, text, via, at}` plus an optional `acceptedAt`. A question with choices needs a `choice`, a `text`, or both, so a note alone is an answer with `choice` `null`; a question without choices needs a `text`. A `text` is 1 to 2,000 characters after trimming. An unknown choice is `choice_unknown`. The reply stores the choice ID, `via` (`ui` from the board or remote access, `chat` when an agent records an answer given in the chat, `cli` from a terminal), and the time. Each unarchived task that refers to the question gets a history entry with the question, the selected label (when there is one), and the note; Done tasks get it as well.
- A reply is written only by a person, and only once. Answering an answered question fails with `question_answered`. Several answers sent together are all written or none is.
- An agent accepts a request with `agboard message accept`, which records `acceptedAt`. A request is accepted once; a second accept fails with `request_accepted`.
- An agent also accepts an answered question with `agboard message accept`, which records `reply.acceptedAt`: the answer is taken in. Accepting a question with no answer fails with `question_open`, and a second accept with `answer_accepted`. `agboard message ask` and `agboard message wait` accept the answers they return when the wait ends because the questions were answered or withdrawn, and an answer an agent writes from the chat (`via: chat`) is accepted as it is written. Until an answer is accepted, it appears in the `answers` of the progress table, the hook, and `wait --until task`.
- Nothing is written to a withdrawn message: answering fails with `question_withdrawn` and accepting with `request_withdrawn`. Only an agent withdraws a question (`ai_only` for a person), and only a person withdraws a request (`human_only` for an agent). A message that already has its reply or acceptance cannot be withdrawn (`message_closed`). Answers already given stay. Lane moves, archive, and deletion never withdraw messages.
- `message link` and `message unlink` add or remove references in a task's `questions` and keep the question's own `tasks` in step. They have the same protections as editing `TASK.md`, and they append history.
- Message texts are trimmed, with CRLF and lone CR normalized to LF.

A message has one of three states: `withdrawn` when `withdrawnAt` is set, `closed` when a question has its reply or a request is accepted (an answer's own acceptance does not change this), and `open` otherwise. The state is derived when the file is read, never stored. The API and the CLI name them `open`, `answered`, or `withdrawn` for a question, and `open`, `accepted`, or `withdrawn` for a request; filters accept `open`, `closed`, `withdrawn`, or `all`.

### Waiting for a person

An AI task waits for a person when it refers to a question without a reply, or to a message file that cannot be read, or when its `questions` frontmatter cannot be read. A withdrawn question does not make a task wait, and neither does a reference that names no message while every message file is readable; that reference is reported in `problems`.

`task.json` stores only `idle` or `running`. When an AI task in Todo or Doing waits, every reader (Summary, snapshot, `show`, progress, and hooks) shows `agentStatus` as `pending`, together with `openQuestionIds` and the `pendingReason` and `pendingChoices` of the open question with the smallest ID. While a task waits, an AI `state <id> running` and an AI move to Done fail with `questions_unanswered`; changes to `idle` and moves by people are allowed. Done, archived, and human tasks show their stored state and keep their references as a record.

Workflow data is never derived from history text. Messages come from their `QA.md` files and references from the `questions` frontmatter, so editing history never changes them.

## History

History is one timeline of work progress and every task operation. Each entry has exactly two fields, in storage, the API, and the CLI alike:

- `at`: UTC time in exactly `YYYY-MM-DDTHH:MM:SSZ`.
- `reason`: 1 to 10,000 characters, not only whitespace.

Extra fields such as an ID, kind, actor, or transition are rejected.

- Create, lane move, run-state change, question, answer, withdrawal, reference change, draft toggle, epic change, archive, restore, a person checking or unchecking a condition, and automatic Done append history automatically. If a move or a state change omits the reason, the product generates one from the operation and the current state.
- Agents append work progress with `agboard --project NAME history add ID [--reason TEXT | --reason-file PATH]`. The product assigns the time and refuses AI appends to drafts, archived tasks, and Done tasks. A blank reason is generated from the current lane and run state.
- `agboard result add` records a result delivered to the requester and appends one entry that names the version and the first line of the summary. A retry of a result that already exists appends nothing. Results themselves are stored in `task.json`, not in history; see [Files](../reference/files.md#results).
- Agents record concise entries at the start, meaningful progress, decisions, verification, interruptions, and resumptions, without asking for approval each time, and never duplicate an entry an operation already appended.
- The UI shows time and content only, newest first, and draws each reason as Markdown, the same way as a task body. CLI `show` and snapshots return the full history.

Generated history from browser operations uses the UI language (`en` or `ja`) sent with that request. Without a supported setting, including CLI operations and automatic Done, the product infers the language from the latest task body: Japanese characters select Japanese; otherwise it uses English. Empty bodies and the default template use the title. Frontmatter and previous history are excluded from inference. Explicit nonblank reasons are preserved verbatim, and existing history is never translated.

Agents must author history in the task body’s language and supply an explicit reason. The [agent skill](./agents.md) defines this workflow.

## Acceptance conditions and automatic Done

Only `TASK.md` has managed acceptance conditions. They sit in frontmatter together with history:

```markdown
---
acceptance:
  - id: AC-1
    text: List tasks as JSON.
    done: false
history: []
---

(Task plan, verification results, references to artifacts)
```

- `acceptance` is a list; omitted, `null`, and empty all mean zero items. Each item has exactly `id` (`AC-<positive integer>`, no leading zero, unique in the file), `text` (1 to 2,000 characters after trimming), and `done` (boolean). Numbers are never reassigned.
- Other top-level keys are preserved on save (YAML formatting may be normalized). A file without frontmatter, or with old heading-based `- [ ] AC-n.` lines, has zero conditions; old formats are not migrated.
- The body holds the plan, concise verification results, and artifact references. Chronological progress goes only to `history`.

**Automatic Done.** An AI-owned, non-draft, unarchived Todo or Doing task with at least one valid condition, all `done: true`, moves to Done by itself. One history entry records it and `taskStatusChangedAt` is updated. Tasks that wait for a person are skipped and re-evaluated when the answer arrives. Tasks with no or invalid conditions, human tasks, and drafts are excluded. `serve` also evaluates existing tasks at startup.

**A person's check.** People check and uncheck one condition at a time from the board or remote access (`PUT .../tasks/{id}/acceptance/{condition}` with `{"done": true|false}`; see [Web API](../reference/web-api.md)). The request carries no version. FileStore reads the latest `TASK.md` under the project lock, changes only that condition, appends a history entry, and saves; so the person's choice wins over a change made since they loaded the task, and the body, the other conditions, and an agent's other edits stay. An archived task is refused (`task_archived`), and an unknown condition is `invalid_argument`. The watcher then evaluates automatic Done as for any change, so checking the last condition of an eligible AI task moves it to Done; unchecking a condition of a Done task leaves it in Done.

**Final result reminder.** Automatic Done does not wait for a final result. Instead the progress table lists, in `finalResultMissing`, each AI task whose conditions are all met and that has no `--final` result, while it is in Todo or Doing and for 24 hours after it moves to Done. Agents record the result with `result add --final`; that is the one AI change a Done task accepts, and only while it has no final result (a progress result, or a second final result, still fails with `task_is_done`). See [Agent output](../reference/agent-output.md).

Done tasks refuse AI changes (edit, state, epic, history, and images) and never reopen automatically; people can still edit and reopen them. An AI lane move to Done is refused with `acceptance_unmet` while a condition is unmet or the frontmatter is invalid, and with `questions_unanswered` while the task waits for a person. Tasks with zero conditions, and moves by people, are not blocked. How this is evaluated is described in [Agent integration](./agents.md#automatic-done).
