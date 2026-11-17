---
title: Decisions
---

# Decisions

A decision is a question an agent asks when it cannot continue without you. It is the place where you step in when asked: the agent stops and waits, and your answer lets it resume. This page shows how you answer on the PC and on your phone, and how an agent asks. For the idea in two sentences, see [The work model](../work-model#decisions). To step in without being asked, see [The board](../watch/board).

## How you notice a question

A question belongs to the project, and a task refers to it. An AI-owned task that refers to an open question is **Pending**. In Todo or Doing, its card says how many questions it waits on, such as **Unanswered questions: 2**, and shows an **Answer the question** button. You can also see Pending tasks on the [remote access](../watch/remote-access).

Every open message of the project is counted in the **Messages** band above the lanes. The band is always there. It shows two counts:

- **AI's questions** is the number of questions and approvals that wait on you, with the split in brackets, such as **(2 questions, 1 approval)**.
- **Your requests** is the number of requests you sent that no agent has picked up yet, marked **waiting to be picked up**.

With nothing open, the counts are 0. Select **Open the list** to read the messages.

## The list of messages

**Open the list** opens the list of messages as a modal on the PC. It has two tabs, **AI's questions** and **Your requests**, each with its count. Each row shows the kind (question, request, or approval), the direction, the ID, the time, and the first line, with its state on the right:

| State | Meaning |
| --- | --- |
| **Unanswered** | A question that waits on your answer. |
| **Answered, waiting for an AI** | A question you answered that no agent has taken in yet. It is not counted as waiting on you. |
| **Awaiting approval** | A plan that waits on your approval. Selecting it opens the review of the plan. |
| **Waiting to be picked up** | A request you sent that no agent has accepted yet. |

Open messages are listed. A question you have answered stays in the list, marked **Answered, waiting for an AI**, until an agent takes your answer in. Then it leaves the list, as do a request an agent accepted and a message that was withdrawn.

Select a question or a request to open it in place of the list. An answered question that waits for an AI opens with the question and **Your answer** read-only, and the note "It leaves the list once an AI takes your answer in." **Back to list** returns to the list. A question opened straight from its card has no list behind it, so it does not show this button.

![The messages list with the AI's questions tab, showing a question and an approval row](../../images/guide/messages-list.png){.screenshot}

## Answer in the browser

Select a question in the list, or select **Answer the question** on its card to open the list at that task's first open question. The question opens in a wide modal with two columns:

- On the left, the question, drawn like a task body. When tasks wait on it, a note above it says so, such as **#21 #22 stay blocked until you reply**.
- On the right, your answer: choose one of the offered options and, if you like, add a note.

**Later** and **Send answer** stay at the bottom, so they are in reach however long the question is. **Send answer** sends your answer at once and returns to the list. **Later** closes the list and keeps nothing. You can also close it with the close button, Escape, or a click outside. Closing never asks for confirmation.

A question with choices needs a choice: a note alone cannot be sent, and **Send answer** stays disabled until you choose one. The note then adds to your choice. A question without choices needs a note. The note takes up to 2,000 characters. Answers are sent one question at a time: there is no review step, and no answer is held on the page.

On a window narrower than 900 px, the question and the answer stack in one column.

![The answer dialog, with the question on the left and the options and note on the right](../../images/guide/question.png){.screenshot}

Each answer is saved to the history of every task that refers to its question. The question and each part of your answer appear as separate blocks there. A task stays in its current column. When none of its questions is open any more, its agent state becomes Idle, and the agent reads your response before it decides how to resume.

A question has no expiry. It stays open until it is answered or the agent withdraws it. Moving or archiving the task does not withdraw it.

### If a question is answered elsewhere or withdrawn

A question can be answered somewhere else, for example in the chat, while you are answering it, and an agent can withdraw a question it no longer needs. Such a question leaves the list, and an open question you were writing returns you to the list. When you send an answer to a question that was just answered or withdrawn, nothing is saved and the dialog says **This question was answered elsewhere or withdrawn.**

### If sending fails

The dialog keeps your choice and note and shows **It could not be sent. Try again.** Select **Send answer** again.

## Review a plan

An **Awaiting approval** row is a plan the agent proposed. Selecting it opens the same plan review as **Review and start** on the **Proposed plan** card at the top of Todo. The review shows the goal, the tasks that will start, and the open questions about the plan, each with an **Answer the question** button that opens that question. **Later** closes the review and changes nothing. **Start with this plan** starts the plan, and it is disabled while a question about the plan is unanswered. The review and what starting does are described in [Proposed plans](../watch/board#proposed-plans).

## Your requests

A request you sent with **Ask AI** shows in the **Your requests** tab as **Waiting to be picked up** until an agent accepts it. Open it to read what you sent, with its images. While it waits, **Withdraw** takes it back, and the request leaves the list. Once an agent has accepted it, it leaves the list, and it can no longer be withdrawn.

## Answer on your phone

On remote access, the same **Messages** band is above the lane tabs, and a Pending task shows the same **Answer the question** button. The band shows the same counts. **Open the list** opens the list as a sheet that slides up from the bottom, and **Ask AI** sits beside it when your phone can send a request.

The sheet works like the modal. The tabs and rows are the same. An open question stacks the answer under the question, and the sheet scrolls while **Later** and **Send answer** stay at the bottom, in reach of your thumb. Opened from a task's **Answer the question** button, the sheet opens at that task's first open question.

![Answer sheet on the phone with the question, choices, note, and the buttons at the bottom](../../images/mobile-question.png){.screenshot .screenshot--narrow}

Tapping the task itself opens its Body, Conditions, History, and Epic drawer. Swipe sideways to switch tabs. See [Remote access](../watch/remote-access) for connecting a phone.

## Answer in the chat

While you are talking with an agent, it writes the same question in the chat as plain text, with its choices and recommendation. Answer there in your own words, or give the id or label of a choice. The agent records your answer on the board with `message answer --via chat`, and the history notes that it came from the chat. Whichever answer is recorded first counts: if the board already has a different answer, the agent tells you which one was recorded and continues with it. The agent does not ask the question again in the other place. See [Questions](./agents#questions) for how agents wait.

## How an agent asks

This section is for people who write or configure agents. The exchange looks like this:

```mermaid
sequenceDiagram
    participant A as Agent
    participant B as Board
    participant U as User
    A->>B: message ask with questions and a task
    Note over B: Task is Pending and shows an answer button
    U->>B: Choose an option and/or write a note
    Note over B: Answer saved, history added to the task
    B-->>A: message ask prints the answers and ends
    A->>B: state running with a reason
```

An agent asks with `message ask`. Each question is saved as its own message with an ID such as `Q-12`, numbered in the project. One command asks up to 20 questions and waits until none of them is open. `--task` makes a task refer to every question of the command; repeat it for more tasks. The questions are written as JSON with `--questions-json`, either inline or from standard input with `-`:

```json
{
  "questions": [
    {
      "body": "Which launch approach should we use?",
      "choices": [
        { "id": "preview", "label": "Publish a preview first" },
        { "id": "public", "label": "Launch publicly" }
      ],
      "recommendedChoiceId": "preview"
    }
  ]
}
```

```sh
cat question.json | agboard --project "My project" message ask --actor ai --task 1 --questions-json - --json
```

- `questions` takes 1 to 20 questions.
- `body` is Markdown, 1 to 5,000 characters. It is drawn like a task body, so headings, lists, code, links, and images attached to the same task appear as they do in the body. Images from `http` or `https` addresses are shown too.
- `choices` is optional and takes 2 to 10 options. Each `id` is 1 to 64 characters of letters, digits, `_`, or `-`, and each `label` is 1 to 200 characters. A question without choices is answered in words.
- `recommendedChoiceId` is optional and names the option the agent recommends.
- `tasks` in a question, such as `"tasks": [421, 422]`, links that question only to those tasks.

The answer note takes up to 2,000 characters. It is required when the question has no choices.

The task must be AI-owned and in Todo or Doing. While it waits, it cannot be set to Running. Moving the task to another column or archiving it does not withdraw its questions.

### What the command prints

With `--json`, the command prints one JSON object per line. Without it, it prints the same events as short sentences.

| Event | Meaning | Exit code |
| --- | --- | --- |
| `registered` | The questions were saved. It holds the question IDs. | — |
| `waiting` | Some question is still open. It is printed every 60 seconds (`--heartbeat` sets 10 to 600). | — |
| `answered` | Every question is answered. It holds all the answers. | 0 |
| `timeout` | The wait ended. The questions stay open. | 5 |
| `withdrawn` | No question is open any more, and some were withdrawn. It holds the withdrawn IDs and the answers that were given. | 6 |
| `error` | Waiting failed after the questions were saved, for example when the server stopped. The questions stay open. | 1 |

The command waits 600 seconds by default. `--timeout` takes 1 to 86,400 seconds, or `none` to wait without a limit. Waiting needs the server; the CLI checks it before saving anything and starts it in the background when none runs. If it cannot start the server, nothing is saved and the command fails with `board_unavailable`. `--no-wait` saves the questions, prints `registered`, and returns at once, without a server.

To wait again after a timeout or an error, pass the question IDs. The questions are not asked a second time:

```sh
agboard --project "My project" message wait Q-12 Q-13 --json
```

### Read, withdraw, and link questions

```sh
agboard --project "My project" message ls --json
agboard --project "My project" message show Q-12 --json
agboard --project "My project" message withdraw Q-12 --actor ai
agboard --project "My project" message link Q-12 --task 3
agboard --project "My project" message unlink Q-12 --task 3
```

- `message ls` lists open messages, which are questions and requests. `--status closed` lists answered questions and accepted requests, `--status withdrawn` lists withdrawn ones, and `--status all` lists every one. `--type question` or `--type request` limits the list to one kind, and `--task` limits it to one task's questions.
- `message show` prints one message in full: for a question, its options, its answer, and the tasks that refer to it.
- `message withdraw` withdraws a question that has no answer yet. Only an agent withdraws a question (`--actor ai`). A waiting `message ask` ends with `withdrawn` once no question is open. A question that already has its answer cannot be withdrawn.
- `message link` and `message unlink` add questions to a task or remove them. They change the `questions` list in the task's `TASK.md` and the `tasks` of the question together.

### Answer from the command line

A person can also answer from the CLI with the question ID, one question per command:

```sh
agboard --project "My project" message answer Q-12 --actor human --via cli --choice preview --text "Get feedback before the public launch"
```

A question with choices needs `--choice`; a question without choices needs a note. Give a note with `--text` or `--text-file`. When the user answers in the chat, the agent records the user's words with `--via chat`. The first recorded answer is final: answering an answered question fails with `question_answered` and prints the recorded answer.

After reading the answers and history, the agent resumes:

```sh
agboard --project "My project" state 1 running --actor ai --reason "Preparing the preview requested by the user"
```

## Requests

A request is a message in the other direction: a person writes it for the agents. It is saved like a question, with an ID such as `Q-13` from the same numbering, and `message ls --type request` lists requests.

```sh
agboard --project "My project" message send --actor human --text "Add a Windows section to the guide" --image ./sketch.png
agboard --project "My project" message accept Q-13 --actor ai
agboard --project "My project" message withdraw Q-13 --actor human
```

- `message send` records a request of 1 to 20,000 characters, from `--text` or `--text-file`. Repeat `--image` to attach pictures.
- `message accept` marks an open request as accepted and records when. It also takes in the answer of an answered question: `message accept Q-12 --actor ai` prints `Accepted the answer of Q-12.` Only an agent accepts, and only once. A question with no answer yet fails with `question_open`, and one already taken in with `answer_accepted`.
- An agent that sees an answer through the hook, the progress table, or `wait --until task` takes it in with `message accept`. `message ask` and `message wait` take in the answers they return, and an answer recorded from the chat is accepted as it is written.
- Only a person withdraws a request, and only while it is open. An accepted request cannot be withdrawn.

## Next

- [Working with agents](./agents): the full work loop, including waiting.
- [Troubleshooting](../operations/troubleshooting): an answer that is refused or a question that disappeared.
