---
title: Quickstart
---

# Quickstart

In about ten minutes you take one task from creation to Done: you add a task, an agent starts it and asks a question, you answer, and the task finishes on its own. You play the agent yourself with a few `agboard` commands, so you do not need an AI agent yet.

You need a running installation. If you have not installed `agboard`, start with [Install and start](./getting-started).

To keep your own board untouched while you try this, run `export AGBOARD_HOME="$(mktemp -d)"` in every terminal you use below. Skip it to use your real board.

## Before you start: the first-run guide

The first time you open a board in this data area, Agent Board offers a short guide. Choose **Start guide** to see how an AI agent works on a card and asks you for a decision. The guide creates two sample cards and simulates the AI's progress on them. No AI agent or API key is needed. You answer the second card's question on the card itself. When you finish, the two samples are archived.

- **Skip** closes the guide without creating anything. The guide is not shown again in this data area.
- **End guide** ends the run early, and so does Escape, unless you are typing in an answer field. Its two cards are archived. The next time you open a board, the guide is offered again with two new cards.

## 1. Start the board

```sh
agboard project create "Quickstart"
agboard serve --port 7420
```

Leave the server running and open [http://127.0.0.1:7420/](http://127.0.0.1:7420/). Select **Quickstart** in the header. The board is empty. Use a second terminal for the commands below.

## 2. Add a task yourself

In the browser, choose **Add task**, then **Create manually** in the request form. Type the title `Write the setup guide`, leave the owner as **User**, and add the task. It appears in Todo as task #1.

## 3. Hand a task to an agent

Create a file `task.md` that contains one acceptance condition:

```markdown
---
acceptance:
  - id: AC-1
    text: The install steps work on a clean machine.
    done: false
history: []
---

Walk through the install steps and note anything that is unclear.
```

Add it as an AI-owned task:

```sh
agboard --project "Quickstart" add "Check the install steps" --assignee ai --actor ai --desc-file task.md
```

The command prints the new task's ID; this page assumes **#2**. The task appears in Todo with an AI icon and `0/1` conditions.

## 4. Play the agent: start working

An agent starts a task by moving it to Doing and reporting that it is running:

```sh
agboard --project "Quickstart" mv 2 doing --actor ai --reason "Start checking the install steps"
agboard --project "Quickstart" state 2 running --actor ai --reason "Following the install page"
agboard --project "Quickstart" history add 2 --reason "Built the web UI and installed agboard without errors"
```

In the browser, task #2 moves to Doing and shows **Running**. Select it and open the **History** tab: each step is there with its time and reason.

## 5. Ask a question and answer it

When an agent needs a decision, it asks a question with choices:

```sh
agboard --project "Quickstart" state 2 pending --actor ai --request-json '{"question":"Should the guide also cover Windows?","choices":[{"id":"yes","label":"Yes, include Windows"},{"id":"no","label":"No, macOS only"}]}'
```

This command waits for your answer by default; `agboard serve` must be running. Task #2 shows **Pending** and the question with its two options. In the browser, choose an option, optionally write a note, and send the answer. The command returns with the answer, and the task returns to **Idle**.

The agent reads the answer in the task's history and resumes:

```sh
agboard --project "Quickstart" show 2
agboard --project "Quickstart" state 2 running --actor ai --reason "Windows is not needed; continuing with macOS"
```

## 6. Finish: check the condition

When the agent has verified a condition, it records the verification and marks the condition done. Mark it done in a copy of the file and apply it:

```sh
agboard --project "Quickstart" history add 2 --reason "Verified the install steps on a clean machine"
sed 's/done: false/done: true/' task.md > task-done.md
agboard --project "Quickstart" edit 2 --desc-file task-done.md
```

With the server running, task #2 moves to Done by itself: every condition is done, so there is nothing left for you to do. This works for AI-owned tasks that are not drafts; your own task #1 stays where you put it.

## 7. Clean up

Press Ctrl+C in the server's terminal. If you used a temporary `AGBOARD_HOME`, there is nothing more to do. Otherwise, delete the practice project (it asks for your confirmation, and agents cannot do it):

```sh
agboard --project "Quickstart" project rm
```

## What you learned

- Tasks move through **Todo → Doing → Done**, and agents report **Idle**, **Running**, or **Pending**.
- Every change is recorded in the task's history with a reason.
- An agent asks you a question with **Pending**, and you answer on the task.
- When all acceptance conditions are done, an AI-owned task finishes by itself.

## Next

- [Core concepts](./concepts): the ideas behind what you just did.
- [Working with agents](./automation/agents): connect a real agent, so that it runs the loop for you.
- [The board](./use/board): everything you can do in the browser.
