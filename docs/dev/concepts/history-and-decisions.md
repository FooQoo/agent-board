# History and decisions

How Agent Board records what happened (history), asks people for decisions (project questions and their answers), and decides when a task is finished (acceptance conditions and automatic Done).

## Questions and answers

Questions belong to the project, not to a task. An agent asks a set of questions with `agboard qa ask`; tasks refer to the questions they wait on.

- One `qa ask` stores one request at `qa/<request-id>/request.json`. A request holds 1 to 20 questions, answered together. The request ID is 32 lowercase hexadecimal characters; each question gets the next project number, `Q-<n>`, from `nextQuestionId` in `project.json`. Numbers only grow.
- A question is Markdown of 1 to 5,000 characters with 2 to 10 choices. Each choice has an ID unique within the question (1 to 64 characters of `[A-Za-z0-9_-]`) and a label of 1 to 200 characters. `kind` is `task` (the default), `plan`, or `start_approval`. `recommendedChoiceId` is optional and must name a choice. A `start_approval` question needs at least one `approvingChoiceIds` entry; other kinds have none.
- `--task <id>`, or `tasks` on a question, adds the question IDs to the task's `questions` frontmatter and appends history with the question and its choices as separate blocks. A Running task returns to Idle in the same save. The tasks must exist, be unarchived, not be drafts, and, for an AI actor, not be Done; otherwise nothing is written.
- An answer accepts a `choiceId`, a `text` of 1 to 2,000 characters after trimming, or both, but not neither; an unknown choice is `request_choice_unknown`. The answer is stored on the question with the label at the time of selection, `actor` (always `human`), and `via` (`ui` from the board or the mobile monitor, `chat` when an agent records an answer given in the chat, `cli` from a terminal). Each unarchived task that refers to the question gets a history entry with the question, the selected label, and the note; Done tasks get it as well.
- The first recorded answer is final. Answering an answered question fails with `question_answered`, and a question of a withdrawn request fails with `question_withdrawn`. Several answers sent together are all written or none is.
- `qa withdraw` withdraws a whole request with an optional reason of up to 2,000 characters. Answers already given stay. A request whose questions are all answered can no longer be withdrawn (`request_answered`). Lane moves, archive, and deletion never withdraw questions.
- `qa link` and `qa unlink` add or remove references in a task's `questions`, with the same protections as editing `TASK.md`, and append history.
- Question and answer texts are trimmed, with CRLF and lone CR normalized to LF.

A question is `open` until it is answered or its request is withdrawn; a request is `answered` when every question is. These states are derived when the file is read, never stored.

### Waiting for a person

A task waits for a person when a question it refers to is open, when a `start_approval` question it refers to was answered with a choice outside `approvingChoiceIds`, when it refers to a `plan` question that is not withdrawn but to no `start_approval` question answered with a choice in `approvingChoiceIds`, or when its references cannot be checked (a broken `request.json`, or broken `questions` frontmatter). The plan rule keeps a planned task waiting after its plan questions are answered and before its start is approved. A withdrawn question does not make a task wait, and neither does a reference that names no question while every request file is readable; that reference is reported in `problems`.

`task.json` stores only `idle` or `running`. When an AI task in Todo or Doing waits, every reader (Summary, snapshot, `show`, progress, and hooks) shows `agentStatus` as `pending`, together with `openQuestionIds` and the `pendingReason` and `pendingChoices` of the open question with the smallest ID. While a task waits, an AI `state <id> running` and an AI move to Done fail with `questions_unanswered`; changes to `idle` and moves by people are allowed. Done, archived, and human tasks show their stored state and keep their references as a record.

Workflow data is never derived from history text. Questions and answers come from `request.json` and references from the `questions` frontmatter, so editing history never changes them.

## History

History is one timeline of work progress and every task operation. Each entry has exactly two fields, in storage, the API, and the CLI alike:

- `at`: UTC time in exactly `YYYY-MM-DDTHH:MM:SSZ`.
- `reason`: 1 to 10,000 characters, not only whitespace.

Extra fields such as an ID, kind, actor, transition, or request ID are rejected.

- Create, lane move, run-state change, question, answer, withdrawal, reference change, draft toggle, epic change, archive, restore, a person checking or unchecking a condition, and automatic Done append history automatically. If a move or a state change omits the reason, the product generates one from the operation and the current state.
- Agents append work progress with `agboard --project NAME history add ID [--reason TEXT | --reason-file PATH]`. The product assigns the time and refuses AI appends to drafts, archived tasks, and Done tasks. A blank reason is generated from the current lane and run state.
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

**A person's check.** People check and uncheck one condition at a time from the board or the mobile monitor (`PUT .../tasks/{id}/acceptance/{condition}` with `{"done": true|false}`; see [Web API](../reference/web-api.md)). The request carries no version. FileStore reads the latest `TASK.md` under the project lock, changes only that condition, appends a history entry, and saves; so the person's choice wins over a change made since they loaded the task, and the body, the other conditions, and an agent's other edits stay. An archived task is refused (`task_archived`), and an unknown condition is `invalid_argument`. The watcher then evaluates automatic Done as for any change, so checking the last condition of an eligible AI task moves it to Done; unchecking a condition of a Done task leaves it in Done.

Done tasks refuse AI changes (edit, state, epic, history, and images) and never reopen automatically; people can still edit and reopen them. An AI lane move to Done is refused with `acceptance_unmet` while a condition is unmet or the frontmatter is invalid, and with `questions_unanswered` while the task waits for a person. Tasks with zero conditions, and moves by people, are not blocked. How this is evaluated is described in [Agent integration](./agents.md#automatic-done).
