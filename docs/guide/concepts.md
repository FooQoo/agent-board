---
title: Core concepts
---

# Core concepts

A handful of ideas explain everything on the board. Read this page once; the other pages assume it.

## Project

A project is one board. It has its own tasks, epics, and history, and nothing is shared between projects. You pick the project in the browser's header; on the command line you name it with `--project NAME`.

## Task

A task is one piece of work. It has:

- a **title** and a **body** (free Markdown: the plan, the results, links to evidence);
- an **owner**: **AI** for work an agent does, **User** for work you do. The owner is fixed when the task is created;
- **acceptance conditions**: a checklist that says when the task is finished;
- a **history**: a time-ordered list of what happened, each entry with a time and a reason.

## Columns

A task is in one of three columns:

| Column | Meaning |
| --- | --- |
| **Todo** | Work that has not started. |
| **Doing** | Work in progress. |
| **Done** | Completed work. |

## Agent state

An AI-owned task also shows what its agent is doing:

| State | Meaning | Where it can happen |
| --- | --- | --- |
| **Idle** | Nothing special: the agent is not working on it right now. | Everywhere. User-owned and Done tasks are always Idle. |
| **Running** | The agent is working on it. | Doing only. |
| **Pending** | The agent is waiting for your answer. | Todo and Doing. |

Running is what the agent last reported; it is not a live check. If an agent crashes, its task stays Running until someone changes it. Moving a task to another column resets it to Idle and withdraws an open question.

## Decisions

When an agent cannot continue without you, it asks a **decision**: a question, usually with a few options. The task becomes **Pending** and shows the question. You choose an option, write a note, or both; the answer goes into the history and the agent reads it before continuing. A question stays open until it is answered. See [Decisions](./use/decisions).

## Acceptance conditions and automatic Done

Acceptance conditions are a checklist on each task. An agent marks a condition done only after it has verified it. When every condition of an AI-owned task is done, the task moves to **Done** by itself (while the server is running). Tasks without conditions, tasks you own, drafts, and Pending tasks do not finish automatically. The file format is described in [Markdown file format](./automation/file-format).

## Epics

An epic groups tasks under one plan. It has a name, a color, a plan written in Markdown, and an order for its tasks. A task belongs to at most one epic. Agents read the order to choose what to do next. See [Epics and progress](./use/epics).

## Drafts

A draft is a task you are still writing. Agents treat it as read-only, so they cannot change it half-written. Finalize it when it is ready. See [Drafts](./use/board#drafts).

## History

Every change adds an entry to the task's history: moves, state changes, questions and answers, and the progress notes that agents add. Each entry has only a time and a reason, so the history reads like a log. The History tab shows it, newest first.

## Where the data lives

Everything is stored as plain files in a folder on your machine (by default `~/.agent-board/`). The browser, the `agboard` command, and the agents all read and write the same files. See [Data and backups](./operations/data).

## Next

- [The board](./use/board): do all of this in the browser.
- [Working with agents](./automation/agents): how an agent uses the board.
