---
title: Quickstart
---

# Quickstart

In about ten minutes you delegate your first piece of work: you tell your agent what you want, it puts a provisional plan on the board, you answer its questions and start it once, and you watch it work until the tasks reach Done.

You need a running installation and an agent. If you have not installed `agboard` and set up your agent, start with [Install and start](./getting-started) and [Working with agents](./delegate/agents#set-up-your-agents).

## 1. Open a project and the board

Create a project for the folder you want the agent to work in, and open the board:

```sh
cd path/to/your/project
agboard project create "My project"
agboard serve
```

Open [http://127.0.0.1:7420/](http://127.0.0.1:7420/) and select **My project** in the header. The board is empty for now. The agent writes the plan, so you do not need to add any tasks yourself.

Start a new agent session in the same folder, so that it loads the plugin. The agent finds the project from the folder.

## 2. Tell the agent what you want

In the agent's chat, ask for a piece of work that is more than one step, in your own words. For example:

> Add a dark mode to the settings page, and update the docs.

You do not set up tasks or conditions. The agent reads the board, and for a request of this size it registers a **provisional plan** at once: an epic with its goal and scope, and the tasks in the order they will be done, each with its acceptance conditions. None of them starts yet, because everything the agent creates is a draft until you start it. Open a card on the board to read the plan while the agent asks about it.

## 3. Answer the plan questions

The agent asks what it cannot settle itself, with choices and a recommendation. It writes each question in the chat, and every question is also on the board, in the **Messages** band and on the tasks that wait for the answer, which show **Pending**. Answer wherever is easier: choose an option on the board or on your phone, or reply in the chat in your own words. The first answer recorded is the one that counts. See [Decisions](./delegate/decisions).

The agent changes the plan as your answers say, and may ask a little more. If it has no questions, it skips this step.

## 4. Start the plan

When the plan reads right, you start it, for example with `agboard epic start <EPIC-ID> --actor human`. That starts the epic and all its drafts. No task starts before then. If you want something changed, tell the agent in the chat and it revises the plan.

## 5. Watch it run

After the start the agent works through the tasks in the epic's order without asking each time. On the board, a task moves to Doing and shows **Running** while the agent works on it. Select a task and open the **History** tab to read what the agent did and why. Check the **Conditions** tab for how many acceptance conditions are done.

The agent stops for you only when your intent is unclear, your preference decides it, an action cannot be undone, or the work grows bigger than you asked. Each stop is a question on the board, and you answer it the same way as before. You can also step in without being asked: move a card back, check or uncheck a condition, or rewrite a task. See [The board](./watch/board).

## 6. See it reach Done

When the agent has verified every acceptance condition of a task and nothing is waiting on you, the task moves to **Done** by itself, as long as the server is running. When the last task is done, the epic's work is complete. Its history keeps the reasons, so you can read back what was decided and how it was checked.

## Practice the loop by hand

If you want to see the loop without an agent, you can play the agent yourself with a few `agboard` commands. This is a way to learn the mechanics, not how you normally work. To keep your own board untouched, create one temporary data folder first: run `export AGBOARD_HOME="$(mktemp -d)"` and `echo "$AGBOARD_HOME"` in the first terminal. In every other terminal you use below, run `export AGBOARD_HOME="<the printed path>"` so that all of them share that folder. Skip this to use your real board.

### The first-run guide

The first time you open a board in this data area, Agent Board offers a short guide. Choose **Start guide** to see how an AI agent works on a card and asks you for a decision. The guide runs in your browser: it draws two sample cards over the board and simulates the AI's progress on them. Your board and your data are never changed. No AI agent or API key is needed. You answer the second card's question in the same answer form you use for real questions, and nothing you choose there is sent anywhere.

- **Skip** closes the guide. The guide is not shown again in this data area.
- **End guide** ends the guide early, and so does Escape, unless you are typing in an answer field. Like **Skip**, it closes the guide for good. **Finish and get started** at the last step also closes it for good.

You can open the guide again at any time, on the screen you are using, whatever it did before. Open Settings and choose **Try it** in the **Tutorial** row. A guide you start this way never changes whether the data area offers it by itself.

### 1. Start the board by hand

```sh
agboard project create "Quickstart"
agboard serve --port 7420
```

Leave the server running and open [http://127.0.0.1:7420/](http://127.0.0.1:7420/). Select **Quickstart** in the header. The board is empty. Use a second terminal for the commands below.

### 2. Add a task yourself

In the browser, open the small menu beside **Ask AI** in the header and choose **Add a task manually**. Type the title `Write the setup guide`, leave the owner as **User**, and add the task. It appears in Todo as task #1.

### 3. Hand a task to an agent

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

### 4. Play the agent: start working

An agent starts a task by moving it to Doing and reporting that it is running:

```sh
agboard --project "Quickstart" mv 2 doing --actor ai --reason "Start checking the install steps"
agboard --project "Quickstart" state 2 running --actor ai --reason "Following the install page"
agboard --project "Quickstart" history add 2 --reason "Built the web UI and installed agboard without errors"
```

In the browser, task #2 moves to Doing and shows **Running**. Select it and open the **History** tab: each step is there with its time and reason.

### 5. Ask a question and answer it

When an agent needs a decision, it asks a question with choices:

```sh
agboard --project "Quickstart" message ask --actor ai --task 2 --questions-json '{"questions":[{"body":"Should the guide also cover Windows?","choices":[{"id":"yes","label":"Yes, include Windows"},{"id":"no","label":"No, macOS only"}]}]}'
```

This command waits for your answer, up to 10 minutes by default, through the server you started. (Without one, it would start a server in the background.) Task #2 shows **Pending** and the question with its two options. In the browser, choose an option, optionally write a note, and send the answer. The command prints the answer and ends, and the task returns to **Idle**.

The agent reads the answer in the task's history and resumes:

```sh
agboard --project "Quickstart" show 2
agboard --project "Quickstart" state 2 running --actor ai --reason "Windows is not needed; continuing with macOS"
```

### 6. Finish: check the condition

When the agent has verified a condition, it records the verification and marks the condition done. Mark it done in a copy of the file and apply it:

```sh
agboard --project "Quickstart" history add 2 --reason "Verified the install steps on a clean machine"
sed 's/done: false/done: true/' task.md > task-done.md
agboard --project "Quickstart" edit 2 --desc-file task-done.md
```

With the server running, task #2 moves to Done by itself: every condition is done, so there is nothing left for you to do. This works for AI-owned tasks that are not drafts; your own task #1 stays where you put it.

### 7. Clean up

Press Ctrl+C in the server's terminal. If you used a temporary `AGBOARD_HOME`, there is nothing more to do. Otherwise, delete the practice project (it asks for your confirmation, and agents cannot do it):

```sh
agboard --project "Quickstart" project rm
```

## What you learned

- You ask, and the agent registers a provisional plan; you do not write it.
- You answer the plan questions, then start the plan once.
- Tasks move through **Todo → Doing → Done**, and agents report **Idle**, **Running**, or **Pending**.
- Every change is recorded in the task's history with a reason.
- An agent asks you a question with **Pending**, and you answer on the task.
- When all acceptance conditions are done, an AI-owned task finishes by itself.

## Next

- [The work model](./work-model): the ideas behind what you just did.
- [Working with agents](./delegate/agents): the full planning and question flow.
- [The board](./watch/board): everything you can do in the browser.
