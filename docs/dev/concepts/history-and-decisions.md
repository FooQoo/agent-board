# History and decisions

How Agent Board records what happened (history), asks people for decisions (Pending and answers), and decides when a task is finished (acceptance conditions and automatic Done).

## Decision requests and answers

When an agent needs a person's decision, it moves the task to Pending with a question and choices:

- The CLI takes `--request-json` with a question (1 to 2,000 characters) and 0 to 10 choices. Each choice has an ID unique within the request (1 to 64 characters of `[A-Za-z0-9_-]`) and a label of 1 to 200 characters. The agent skill asks for 2 to 10 choices; that is policy, not an input constraint.
- A new `pendingRequestId` is generated, and `pendingRequest` stores `{question, choices}`. History gets an entry describing the request.
- An answer must name the current request ID; otherwise it fails with `request_changed`. It accepts a `choiceId`, a `text`, or both, but not neither; an unknown choice is `request_choice_unknown`. The answer is stored in `requestAnswers` with the label at the time of selection, the request is cleared, the task returns to Idle in the same lane, and history gets an entry. Resuming Running is a separate change.
- Question and answer texts are trimmed, with CRLF and lone CR normalized to LF.

Workflow data is never derived from history text. The current question comes from `pendingRequest` and answers from `requestAnswers`, so editing history never changes them.

## History

History is one timeline of work progress and every task operation. Each entry has exactly two fields, in storage, the API, and the CLI alike:

- `at`: UTC time in exactly `YYYY-MM-DDTHH:MM:SSZ`.
- `reason`: 1 to 10,000 characters, not only whitespace.

Extra fields such as an ID, kind, actor, transition, or request ID are rejected.

- Create, lane move, run-state change, decision request, answer, draft toggle, epic change, archive, restore, and automatic Done append history automatically. If a move or a non-Pending state change omits the reason, the product generates one from the operation and the current state.
- Agents append work progress with `agboard --project NAME history add ID [--reason TEXT | --reason-file PATH]`. The product assigns the time and refuses AI appends to drafts, archived tasks, and Done tasks. A blank reason is generated from the current lane and run state.
- Agents record concise entries at the start, meaningful progress, decisions, verification, interruptions, and resumptions, without asking for approval each time, and never duplicate an entry an operation already appended.
- The UI shows time and content only, newest first. CLI `show` and snapshots return the full history.

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

(Task plan, verification results, references to artifacts and evidence)
```

- `acceptance` is a list; omitted, `null`, and empty all mean zero items. Each item has exactly `id` (`AC-<positive integer>`, no leading zero, unique in the file), `text` (1 to 2,000 characters after trimming), and `done` (boolean). Numbers are never reassigned.
- Other top-level keys are preserved on save (YAML formatting may be normalized). A file without frontmatter, or with old heading-based `- [ ] AC-n.` lines, has zero conditions; old formats are not migrated.
- The body holds the plan, verification results, and references; full logs go to evidence files. Chronological progress goes only to `history`.

**Automatic Done.** An AI-owned, non-draft, unarchived Todo or Doing task with at least one valid condition, all `done: true`, moves to Done by itself. One history entry records it and `taskStatusChangedAt` is updated. Pending tasks wait until they are answered and are then re-evaluated. Tasks with no or invalid conditions, human tasks, and drafts are excluded. `serve` also evaluates existing tasks at startup.

Done tasks refuse AI changes (edit, state, epic, history, evidence, images) and never reopen automatically; people can still edit and reopen them. An AI lane move to Done is refused with `acceptance_unmet` while a condition is unmet or the frontmatter is invalid. Tasks with zero conditions, and moves by people, are not blocked. How this is evaluated is described in [Agent integration](./agents.md#automatic-done).
