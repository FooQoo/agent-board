# Ask the user on the board

Every question goes on the board with `message ask`, never only in chat. Permission ("may I...?"), a question ending a progress report, and confirming an action a subagent was denied are questions too. Before ending a turn, re-read your reply: if it still asks anything that waits on the user, put it on the board now. Before asking, update the task plan if needed with the facts, impact, options, and recommendation. Each question is its own message (`Q-<n>`) and belongs to the project; `--task` makes the task refer to it, and the task shows as `pending` while any question it refers to is open. The command records the question in the task's history. Write the questions as JSON and pass them with `--questions-json`, inline or from standard input with `-`:

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
- **Visual questions carry their images** in `images`, shown in the `body`; never only a local link (the user may be on a phone).
- The command prints one JSON line per event. The first line is `registered`, with the question IDs (`Q-<n>`); keep them. While it waits it prints a short `waiting` line every 60 seconds. The last line is `answered` with all answers (exit 0), `timeout` (exit 5), `withdrawn` (exit 6), or `error`.
- The task must be an AI task in `todo` or `doing`. While it waits, `state <id> running` is refused with `questions_unanswered`.

## Ask about the reading, not only the details

A short request often names a feeling or a gesture, not the change. Before you plan around your first reading, write the reading back in your own words and ask whether it is right. Cover:

- **The target.** What the request acts on: a card or a lane, one item or many, this screen or every screen.
- **The purpose.** What the person wants to stop doing or be able to do. The purpose often picks the design for you.
- **The nearest existing behavior.** Name a behavior the product already has that works the same way, so the person can say "yes, like that".
- **Words with two meanings.** When a word reads two ways (for example "select all" or "start selecting"), ask which one.

Put the reading in the body and offer the likely readings as choices, with your recommendation:

```json
{
  "questions": [
    {
      "body": "I read \"a right swipe in the Backlog lane\" as a lane gesture: swiping right past the lane's first edge starts selecting cards, like the Done lane's swipe that archives all. It saves scrolling to the Select button at the bottom. Is that right?",
      "choices": [
        { "id": "lane-select", "label": "Yes: a lane swipe that starts selecting" },
        { "id": "card-move", "label": "No: a card swipe that moves that card" }
      ],
      "recommendedChoiceId": "lane-select"
    }
  ]
}
```

Do not make the choices variations of your own first reading: include the readings that differ in target or purpose. When you delegate the work, pass the confirmed reading and its purpose to the subagent, not only the request text.

## Wait for the answers

Keep the command running until its last line, with the default 600-second limit. Run it in the background where your agent can and is told when it ends (Claude Code); otherwise run it in the foreground (Codex reads a long command in chunks and does not cut it off). After `timeout`, the questions stay open: wait again with `agboard --project "<name>" message wait <Q-id> [<Q-id>...] --json`, the same way, for as long as the answer is needed. Never ask the same questions a second time. `withdrawn` means no question is open any more and some were withdrawn. After an `error` such as `board_unavailable`, wait again with `message wait`. None of these is an answer, and dependent work waits for the actual answer. A command that waits starts the server itself; do not start `agboard serve` first. Use `--no-wait` only when the user explicitly asks to register a question and return immediately.

## In a conversation, also show the question in the chat as plain text

Right after `registered`, write the question, each choice with its `id` and label, and your recommendation in the chat, and say the same question is on the board. Do not use your agent's question tool (such as AskUserQuestion in Claude Code): it blocks you, so you cannot notice an answer given on the board, and dismissing it looks like a refusal. The user may answer in the chat or on the board, whichever comes first. Once either has an answer, never ask the same question again in the other place.

- **Claude Code.** Run `message ask` in the background, then end your turn. An answer on the board finishes the command and wakes you; read its `answered` line and continue.
- **Codex.** It cannot be woken from the background, so run `message ask` in the foreground after showing the question. The user answers on the board, or interrupts and replies in the chat.
- **A chat answer.** Record it with the user's own words, then continue:

```sh
agboard --project "<name>" message answer <Q-id> --actor human --via chat [--choice <id>] [--text "<their words>"]
```

The waiting command then ends with `answered` on its own; do not record the answer twice. If the board already has an answer, `message answer` fails with `question_answered` and prints it: the first answer stands. Continue with it and tell the user which answer stands; if they want the other one, ask a new question. Never answer a question yourself, and use `--actor human` only for the user's own words. When nobody is in the conversation, such as while listening or during a long unattended run, ask and wait on the board only.

## Afterwards

If the board is unavailable, report the connection problem and leave dependent work blocked; do not ask only in the chat instead. To show the user the board, run `agboard open`. Read a question and its answer with `agboard --project "<name>" message show <Q-id> --json`, and the open messages with `message ls --json`. An answer also appends a concise history reason to each task that refers to the question. To open the board on the phone, run `agboard skills phone`.

After the answer, read the complete snapshot and history, reconsider the plan, and resume as `agboard skills waiting` describes.
