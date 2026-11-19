---
name: wait
description: Keep this session on the Agent Board, listening for requests, answers, and eligible tasks, and process each one before waiting again. Use when the user asks you to listen, wait on the board, or stay attached to the board, for example "listen", "wait on the board", "待ち受けて", "張り付いて".
compatibility: Requires the agboard CLI on PATH and a local Agent Board data area. The listener starts the local agboard server when it is not running.
allowed-tools: Bash(agboard *)
---

# Agent Board resident listening

Invoking this skill is the user's explicit request to listen on the board. This session stays on the project of the current folder, waits for answers, requests, and eligible tasks, handles each one through the normal Agent Board procedure, and then waits again.

## Steps

1. Run `agboard skills` and follow it as the main procedure (project selection, work loop, asking, accepting requests and answers).
2. Run `agboard skills resident` and follow that resident procedure (it builds on `agboard skills listening`), with these differences:
   - If the user gave no idle timeout, use 3600 seconds and do not ask.
   - When `wait --until task` returns `idle_timeout`, do not finish. Start the same wait again.
   - Stop only when the user interrupts or asks you to stop, or on an error the listening procedure says to stop on: `board_unavailable`, `local_network_denied`, `project_not_found`, or invalid arguments. Report the error and its recovery step.
3. Keep the listening rules: answers come before requests, and requests before tasks. Accept a request or answer before acting on it. Ask on the board with `message ask`, not in the chat. Run the wait in this session; never hand the wait itself to a background agent.

Answer in the language the user speaks with you.
