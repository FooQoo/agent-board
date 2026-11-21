# Stay on the board as a resident agent

There are two kinds of resident agent, and the environment tells them apart:

- **Launched by the board** (`AGBOARD_RESIDENT_ID` and `AGBOARD_SESSION_ORIGIN=board` are set). The board watches the project for you and sends each piece of work as a message when you are idle. Follow "Work the board pushes" below, and never run `agboard wait`.
- **Opened by a person** who told you to stay on the board. Nothing sends you work, so you wait for it yourself. Follow "Wait for work yourself" below.

Both keep one session attached to one project and working until the board stops the process. Neither ends when the board is idle; that is the difference from `agboard skills listening`, which ends at `idle_timeout` and is for an explicit one-off request.

Nobody watches a board-launched session. It runs headless with automatic approval: a prompt for permission is refused rather than shown. So never ask a person anything in the chat. Every question for a person goes on the board with `message ask`, as the main Skill describes.

## Work the board pushes

Only a session the board launched follows this part.

1. Resolve the project as the main Skill describes (`agboard skills`), read the complete project snapshot, and inspect every AI task's `agentStatus`. Resolve work that is `running` or `pending` first, as `agboard skills listening` describes for a resumed session. Then end your turn. Do not start a wait: the board sends the next message when it has work.
2. A message that starts with "Agent Board has work for you" carries one JSON object, of the same shape `wait --until task --json` returns. Handle it as follows, then end your turn:
   - `"kind":"answers"`: answers to questions you asked. Read each with `message show <id>`, act on it, and take it in with `message accept <id> --actor ai`.
   - `"kind":"requests"`: open requests. Read each with `message show <id>`, take it with `message accept <id> --actor ai`, and plan it as `agboard skills planning` describes. If `message accept` says another session already took it, drop it.
   - `"kind":"task"`: a ready task. Work it as `agboard skills listening` describes under "Process one returned task".
3. The board never sends a message while you are working, so the next one arrives after your turn ends. A turn that ends with the item still open (for example a request you did not accept) is sent again after a delay, and the board gives up after three tries, so finish what you were given or say on the board why you cannot.
   - If the item waits for a person (a check on a real device, a decision, a review), you cannot advance it, and leaving it Doing or Idle only makes the board send it again. Ask what you need with `message ask --no-wait --task <id> ...`, record that the task waits for the answer, and end your turn. A task with an open question is Pending, so the board stops sending it until the person answers.
4. Ending your turn is how you stay attached. Do not run a wait, and do not poll the board.

The board asks questions of people for you: use `message ask`, and the answer comes back to you as an `answers` message.

## Wait for work yourself

Only a session a person opened and told to stay on the board follows this part and the rest of this page, except the section on decisions, which is the same for both kinds.

### Start

1. Resolve the project as the main Skill describes (`agboard skills`). Never broaden the session to other projects. If the folder is not bound (`folder_unbound`), report it and stop; there is nobody to retry for you.
2. Read the complete project snapshot and inspect every AI task's `agentStatus`. Resolve work that is `running` or `pending` before waiting, as `agboard skills listening` describes for a resumed session.

### The loop

Run this wait, and nothing else, as the way to wait for work:

```sh
agboard --project "<current project name>" wait --until task --idle-timeout 3600 --json
```

- **Claude Code**: a long command in the foreground is stopped by the harness. Run the wait with the Bash tool's `run_in_background` option, end your turn, and continue when its completion notification arrives. Read the result from the notification's output. A background command has its own time limit, so give it a `timeout` longer than the wait (3900000 milliseconds for 3600 seconds). If the harness stops the wait anyway, treat that like `idle_timeout` and wait again.
- **Codex**: run the wait in the foreground. It blocks until it returns.

Then handle the result:

- `{"kind":"answers", ...}`: read each answer with `message show <id>`, act on it, and take it in with `message accept <id> --actor ai` (Take in an answer, in the main Skill). Until accepted, the next wait returns it again.
- `{"kind":"requests", ...}`: read each with `message show <id>`, take it with `message accept <id> --actor ai` (Accept a request, in the main Skill), and plan it as `agboard skills planning` describes (a Backlog plan only when the request asks for the plan only). Ask the questions that change the plan with `message ask`.
- `{"kind":"task", ...}`: work the task as `agboard skills listening` describes under "Process one returned task": re-read it, check that it is still ready, move it to Doing and Running, work with history, verify, and record the result. Let Agent Board complete it; do not move it to Done by hand.
- `{"kind":"idle_timeout", ...}`: nothing to do. This is not an ending.

Answers come before requests, and requests before tasks. When you have handled the result, wait again.

### Never end on idle

When a wait times out, returns `idle_timeout`, or returns with nothing left to do, run the same wait again immediately, within a few seconds. Do not summarize, report completion, or ask whether to continue. The board counts a session as attached while its wait is open, and keeps a closed wait counted for only 30 seconds. A longer gap drops this session from the count, and the board may launch a second session for the same project.

Run the next wait before long optional work, such as a final summary. Stop only when the board stops the process.

## Decisions for a person

A session the board launched asks with `message ask --no-wait`, records that the task waits for the answer, and ends its turn; the answer arrives as an `answers` message. The rest of this section is for a session that waits for itself.

When a task needs a decision that is a person's (one of the four cases in the main Skill), register it with `message ask --task <id> ...` and do not wait on it with the foreground command. Use `--no-wait`, record that the task is waiting for the answer, and go back to the loop. The answer comes back from `wait --until task` as an `answers` result; take it in, then resume that task with a reason. A task with an open question is Pending and is never returned, so the session keeps working on other tasks while it waits. Never block the whole session on one question, and never leave the loop to wait on one.

## Errors

- `local_network_denied`, `board_unavailable`, malformed project data, a mismatched server, `project_not_found`, and invalid arguments are errors, not an empty board. Report the error and its recovery step, then stop. The board sees the session end and decides whether to start it again.
- If the wait is interrupted, fetch a fresh snapshot, inspect every AI task by `agentStatus`, resolve `running` or `pending` work, and start the loop again.
