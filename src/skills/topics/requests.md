# Accept a request and take in an answer

## Accept a request

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
3. Plan it as `agboard skills planning` describes. The acceptance carries no text and links to nothing, so tell the person what you did through the plan they will see, and through questions.

Accept a request before you plan it, and plan only requests you have accepted. Do not ask the person what they meant by a request before you have put a plan on the board; ask about what you cannot settle after the plan exists.

## Take in an answer

A person's answer to your question reaches you in the same places as a request, when you did not wait for it with `message ask` or `message wait`:

- `answers` in the progress table (and in the hook output): `[{"id":"Q-12","title":"...","tasks":[21],"choiceId":"keep","choiceLabel":"Keep","text":null,"answeredAt":"..."}]`. `choiceId` and `choiceLabel` are `null` when the user answered with only a note, so read `text` then. The field is absent when every answer was taken in.
- `wait --until task` returns `{"kind":"answers", ...}` before requests and tasks while an answer waits.

Read it with `agboard --project "<name>" message show <Q-id> --json`, act on it, and then take it in:

```sh
agboard --project "<name>" message accept <Q-id> --actor ai
```

Until you accept, the answer stays in `answers` and the person sees it as waiting for an AI. `message ask` and `message wait` already accept the answers they return, and so does an answer you record from the chat, so accept only what you saw through `answers`. `question_open` means the question has no answer yet; `answer_accepted` means it was already taken in.
