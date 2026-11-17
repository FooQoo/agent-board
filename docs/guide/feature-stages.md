---
title: Feature stages
---

# Feature stages

Every feature in Agent Board v1.0.0 is in one of two stages: general availability (GA) or public preview. This page explains what each stage means, lists the features in each, and states the limits you should know before you rely on a preview feature. Version 1.0.0 mixes both stages, so not every feature in it is GA.

## What the stages mean

| Stage | What it means | What it does not mean |
| --- | --- | --- |
| General availability (GA) | The feature works the way it is described in this guide, and we plan to keep it that way for a good while. Later changes are meant to add to it. | It does not mean the feature is free of bugs. It is not a promise of unlimited compatibility or support. |
| Public preview | The feature is published so you can try it. Its behavior and specifications may change in a later version, and the limits listed below apply. | It does not restrict what you can do with the feature or change its license. |

The stage describes how much the feature may still change. It does not say how thoroughly the feature has been tested, and a feature does not become GA just because it is used often.

## Notice in the product

A public preview feature tells you before you use it. The notice says:

> This feature is in public preview. Its behavior and specifications may change. See the documentation for current limitations.

Where you see it:

| Feature | Where the notice appears |
| --- | --- |
| [Docs](#docs) | The heading of the Docs dialog shows a **Public preview** badge, with the notice and a link to this page below it. |
| [Remote access](#remote-access) | The **Remote connection** dialog on the computer shows the badge. Before you connect, it also shows the notice and a link to this page. The monitor on the phone does not show it. |
| [Task listening](#listen) | No screen. This page and the agent skill describe it. |

Features that are GA show no notice.

## Features in general availability

| Feature | Supported range | Known limits | Guide |
| --- | --- | --- | --- |
| Tasks and run states | macOS, the board in a PC browser, viewing on remote access | An agent cannot change a task that is Done, a draft, or archived. | [The board](./watch/board) |
| Acceptance conditions and history | Same | A history entry has only a time (`at`) and a reason (`reason`). | [The board](./watch/board), [Markdown file format](./reference/file-format) |
| Editing text and images | PC browser | Image size limits apply. | [Editing and image attachments](./watch/editing) |
| Archive and delete | PC browser | Only a person deletes. | [Archive](./watch/board#archive) |
| Decisions and answers | PC, remote access, CLI | An agent waits for your answer without a time limit by default. The waiting command starts the server when it is not running. | [Decisions](./delegate/decisions) |
| Epics and progress table | PC browser, CLI | The progress table leaves out Pending tasks. | [Epics and progress](./watch/epics) |
| Projects and working folders | CLI, PC browser | The nearest bound folder decides which project a folder belongs to. | [CLI reference](./reference/cli#projects) |
| Saving and recovery of data | macOS | Only files with `formatVersion` 1 are supported. | [Data and backups](./operations/data) |
| Language and themes | PC, remote access | English and Japanese, and 24 themes. | [Settings](./watch/board#settings) |
| Agent CLI, JSON output, Hook, and `wait` | Claude Code, Codex | The Hook and the Skill must match the installed `agboard`; run `agboard update` after upgrading it. You start the agent yourself. | [Working with agents](./delegate/agents) |
| `setup` and `update` | macOS, with Claude Code or Codex found on your `PATH` and a network connection to GitHub | On a terminal both commands ask first; `--yes` agrees in advance. They depend on the plugin commands of Claude Code and Codex. | [Working with agents](./delegate/agents#set-up-your-agents), [CLI reference](./reference/cli#setup-and-update) |
| First-run welcome | PC and phone browsers | It is offered once for a data area, and you can show it again from Settings. It runs in the browser and never changes your board. | [The first-run guide](./watch/board#the-first-run-guide) |

## Features in public preview

### Docs {#docs}

The Docs dialog lets you browse and read the files in a project's `docs/` folder. The feature is still changing.

- **Supported range:** the board in a PC browser. Remote access does not show Docs.
- **Limits:** a Markdown or MDX file can be up to 2 MiB, and an image up to 10 MiB.
- **Guide:** [Project docs](./watch/docs).

### Task listening {#listen}

`agboard wait --until task` lets one open Claude Code or Codex session keep picking up AI tasks one after another.

- **Supported range:** Claude Code and Codex, following the procedure in the agent skill.
- **Limits:** it does not guarantee that two sessions will not pick the same task. A person starts the continuous run in the agent's session.
- **Guide:** [Listen for the next task](./delegate/agents#listen-for-the-next-task).

### Remote access {#remote-access}

Remote access shows the board on a phone and lets you answer an agent's question.

- **Supported range:** the browser of a smartphone, through ngrok.
- **Limits:** it depends on ngrok, and ngrok ends the HTTPS connection. It works only while your computer is on and the server is running. The way it connects may change.
- **Guide:** [Remote access](./watch/remote-access).

## Related

- [Install and start](./getting-started)
