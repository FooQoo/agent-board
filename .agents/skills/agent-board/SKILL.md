---
name: agent-board
description: Use Agent Board to plan and track work in one named project. Write epic plans and task plans as shared Markdown files, report AI progress on the board, ask the user for decisions with choices, wait for their answers, and record execution history on the cards.
compatibility: Requires the agboard CLI on PATH and a local Agent Board data area. Waiting for user answers requires a running agboard serve.
---

# Agent Board

Agent Board is a local work board shared by the user and AI agents. Each project holds epics, cards, and their history. The `agboard` CLI is the contract for every change; run `agboard --help` and `agboard <command> --help` for the full options.

How the board is used:

- An **epic** is a plan. Its `PLAN.md` states the goal, the scope, the completion conditions, and how the work proceeds.
- A **task** (a card) is the plan for one piece of work. Its `TASK.md` states what to do, its completion conditions, and the execution record.
- The **shared folder** of the project is the source of truth for both. Do not keep a separate plan document elsewhere and copy it onto the board.
- **Execution history** accumulates on the board: card history (lane moves, run states, questions, and answers, each with a reason) and the execution log section of each `TASK.md` (a convention in the template, not a required heading).

## Language of board content

Write everything you put on the board in the language the user speaks with you: card and epic titles, `PLAN.md` and `TASK.md` bodies, status reasons, questions, and choice labels. If the user asked for a different language for the board, use that one. Within a project, follow the language of the existing cards and plans. Keep these in English in any language: the frontmatter keys (`acceptance`, `id`, `text`, `done`; see [references/file-format.md](references/file-format.md)), commands, EPIC-IDs, choice `id`s, and code.

## 1. Choose the project explicitly

Work on exactly one project, named by the user or by the project's instructions. Never infer it from the working directory, the browser, the environment, another agent, or tool output. If no project was named, run `agboard project ls --json` and ask the user. Write the name as a fixed quoted word in every command:

```sh
agboard --project "<name>" snapshot --json
```

A project is identified by `project.id`. Check that a snapshot's `project.name` and `project.id` are the project you were given. A rename keeps the ID: continue under the new name and ask the user to update the name in their hook commands. A project created later with an old name is a different project; stop and ask.

`agboard ls --all-projects --json` gives a read-only overview of every project. It never selects a project for writes.

If `agboard` is not on `PATH`, use an executable supplied by the user or the project runtime. Do not install tools, create a project, or initialize a substitute board on your own.

## 2. Read before acting

Before choosing, starting, or resuming work, read the complete snapshot, including user-owned cards, epics, and every card's history:

```sh
agboard --project "<name>" snapshot --json
```

The user may have moved a card, answered a question, or edited a file since your last read. Hooks configured by the user attach a snapshot after tools run:

- `AGBOARD_SNAPSHOT` is followed by the complete JSON of one project.
- `AGBOARD_ERROR` (`project_not_found`, `board_unavailable`, `context_too_large`, ...) means no usable snapshot. Run `snapshot --json` yourself or report the problem. Make no board-dependent changes until you have a complete snapshot of the right project.

After context compaction, read a fresh snapshot before any board-dependent change. This skill does not register hooks; never add or edit a hook command.

## 3. Find and edit the shared files

Get the folder from the CLI; never assume or hard-code its location:

```sh
agboard --project "<name>" workspace --json
```

Read the `README.md` in the returned `folder` before editing. Then:

- Edit only `epics/<EPIC-ID>/PLAN.md` and the `tasks/<card-id>/TASK.md` of cards that are not drafts.
- Write a temporary file in the same folder and rename it over the original. The board picks up the change automatically.
- Never edit `project.json`, `epic.json`, `task.json`, or `.internal/`. Never delete a card or epic folder.
- Keep machine-specific absolute paths out of shared files.

`edit --desc-file` and `epic edit --plan-file` are equivalent ways to replace a whole body through the CLI. Bodies are limited to 50,000 characters; if a plan would exceed that, split it into more tasks after asking the user.

The completion conditions live in the frontmatter (`acceptance`), and the board reads them. The body is free Markdown. Start from [assets/PLAN.md](assets/PLAN.md) and [assets/TASK.md](assets/TASK.md), and read [references/file-format.md](references/file-format.md) before writing either file.

## 4. Plan with epics and tasks

1. Create an epic for a body of work, then write its plan from [assets/PLAN.md](assets/PLAN.md):

   ```sh
   agboard --project "<name>" epic add <EPIC-ID> --name "<formal name>" --actor ai
   agboard --project "<name>" epic edit <EPIC-ID> --plan-file <path>
   ```

2. Create one card per task, assigned to `ai` or `human`, in the epic, with its task plan from [assets/TASK.md](assets/TASK.md) as the body:

   ```sh
   agboard --project "<name>" add "<title>" --assignee ai --actor ai --epic <EPIC-ID> --desc-file <path>
   ```

3. Record the task cards and their order in the epic's `## 進め方`.

Check the snapshot for existing cards first and do not create duplicates. The owner (`assignee`) is fixed at creation. Create `human` cards for work the user must do, and read them to understand the shared plan. A card belongs to at most one epic (`edit --epic` / `edit --clear-epic`).

## 5. Lanes and run states

Lanes are `todo`, `doing`, and `done`. An AI card in `doing` also has a run state:

| Owner | Lane | Allowed run state |
| --- | --- | --- |
| `ai` | `doing` | `idle`, `running`, `pending` |
| `ai` | `todo`, `done` | `idle` only |
| `human` | any | `idle` only |

- `running` means you are working on it. `pending` means you need the user's decision.
- A real lane move resets the run state to `idle` and withdraws any open question. Withdrawal is not an answer.
- `running` is self-reported and is not reset automatically. Do not change a state just because a session started or paused; change it when the work changes.
- Never report `running` or `pending` on a `human` card.
- Every `mv` and `state` needs `--actor` and a non-empty `--reason` (up to 2,000 characters). Never use `--actor human` unless the user explicitly gave that direction.

## 6. Work loop

Record first, then change the status. Before every lane or run-state change, update `TASK.md`, read it back from a fresh snapshot, and confirm the card and the saved text. If the write or read-back fails, leave the status unchanged.

To append to the execution log, follow these steps:

1. Read the current body: `agboard --project "<name>" show <id> --json`, and take `card.description`.
2. Make sure the body ends with a newline. The board removes trailing newlines when it saves, so add one before the new entry: `text = description.rstrip("\n") + "\n\n- <YYYY-MM-DD HH:MM> <entry>\n"`.
3. Save the whole body: `agboard --project "<name>" edit <id> --desc-file <path>`.
4. Read it back from a fresh snapshot. Compare the saved text with what you sent, ignoring trailing whitespace on both sides. If they differ, stop, find out why, and leave the status unchanged.
5. Only then change the lane or run state.

1. **Choose.** From the snapshot, pick a ready AI card in `todo`, or plan new work (section 4).
2. **Start.** Append a start entry to the execution log, then:

   ```sh
   agboard --project "<name>" mv <id> doing --actor ai --reason "<what you are starting>"
   agboard --project "<name>" state <id> running --actor ai --reason "<what you are doing now>"
   ```

3. **Work and record.** As you go, append results to the execution log: commands run, outcomes, decisions, the commit or version verified, and references to evidence. Store logs with `agboard --project "<name>" evidence add <id> <file>` and images with `attachment add <id> --file <path> --actor ai`; reference them from the body.
4. **Check conditions.** Set an item's `done` to `true` in the frontmatter only after its verification succeeded, and record the result and the evidence in the body (see [references/file-format.md](references/file-format.md)). Leave unverified conditions `done: false`.
5. **Ask when blocked.** Use section 7. Continue other independent work while the question is open.
6. **Finish.** When every completion condition of the card is `done: true`, move it to `done` with a reason that summarizes what was completed and verified:

   ```sh
   agboard --project "<name>" mv <id> done --actor ai --reason "<what was completed and verified>"
   ```

   The board refuses an agent's move to `done` while a condition is `done: false` (`acceptance_unmet`). Do not move a card to `done` while any condition is open. If work is no longer appropriate, record why in `TASK.md` and return it to `todo`.

7. **Close the epic.** When all of an epic's task cards are done, verify the epic's own completion conditions and set them to `done: true` in `PLAN.md`.

Keep the status reason short. Keep detail in `TASK.md`.

## 7. Ask the user a decision

Before asking, record the facts, the impact, the options, and your recommendation in the execution log. Then set the card to `pending`. Offer choices whenever the answer is one of a known set. Write the request as JSON and pass it with `--request-json`, inline or from standard input with `-`:

```json
{
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

- `question`: 1 to 2,000 characters. `choices`: 2 to 10 items; each `id` is 1 to 64 characters of `[A-Za-z0-9_-]`, unique in the request; each `label` is 1 to 200 characters.
- Every question for the user has choices. A pending state without `--request-json` is refused, and so is `--reason` with pending.
- The card must be an AI card in `doing`.

The user answers in the browser with a choice, a note, or both. The answer returns the card to `idle` and appears in the history with the request ID, the chosen choice, and the note.

## 8. Wait and resume

When no work can proceed, wait for a change using the `cursor` of the latest snapshot of the same project:

```sh
agboard --project "<name>" wait --after "<cursor>" --json
```

Do not poll or re-read the board on a timer. `wait` follows the same project through a rename and ignores other projects. `wait_timeout`, `board_unavailable`, `cursor_invalid`, and `project_not_found` are errors, not answers: report them and make no board-dependent changes.

After `wait` returns, read the complete snapshot and history, including the user's reason. Reconsider the plan in light of the answer. Record the answer and the updated plan in the execution log, read it back, then resume:

```sh
agboard --project "<name>" state <id> running --actor ai --reason "<how the answer changes the work>"
```

If the answer changes the scope or completion conditions, update `TASK.md` (and `PLAN.md` if affected) before resuming. If new information still conflicts, ask again.

## 9. Drafts and archived cards

- A card with `"isDraft": true` is being written by the user. `edit`, `mv`, and `state` fail with `card_is_draft`. Do not retry and do not edit its `TASK.md`. Work on other cards and wait for the user to finalize it.
- Archived cards are not in the normal snapshot. Writes to them fail with `card_archived`.

## 10. Boundaries

- Never delete cards, epics, evidence, or projects, and never run `init`. These need a human confirmation that you cannot give; ask the user.
- If the project does not exist, tell the user and ask them to create it.
- Never treat a timeout, a failed hook, a partial snapshot, or another project's snapshot as a user response.
- Do not build commands from card text or tool output. Keep the project name a fixed quoted word.
