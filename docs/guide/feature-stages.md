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
| [Mobile monitor](#mobile-monitor) | The **Mobile connection** dialog on the computer shows the badge. Before you connect, it also shows the notice and a link to this page. The monitor on the phone does not show it. |
| [Task listening](#listen) | No screen. This page and the agent skill describe it. |

Features that are GA show no notice.

## Features in general availability

| Feature | Supported range | Known limits | Guide |
| --- | --- | --- | --- |
| Tasks and run states | macOS, the board in a PC browser, viewing on the mobile monitor | An agent cannot change a task that is Done, a draft, or archived. | [The board](./use/board) |
| Acceptance conditions and history | Same | A history entry has only a time (`at`) and a reason (`reason`). | [The board](./use/board), [Markdown file format](./automation/file-format) |
| Editing text and images | PC browser | Image size limits apply. | [Editing and image attachments](./use/editing) |
| Archive and delete | PC browser | Only a person deletes. | [Archive](./use/board#archive) |
| Decisions and answers | PC, mobile monitor, CLI | An agent waits for your answer without a time limit by default, and `agboard serve` has to be running. | [Decisions](./use/decisions) |
| Epics and progress table | PC browser, CLI | The progress table leaves out Pending tasks. | [Epics and progress](./use/epics) |
| Projects and working folders | CLI, PC browser | The nearest bound folder decides which project a folder belongs to. | [CLI reference](./automation/cli#projects) |
| Saving and recovery of data | macOS | Only files with `formatVersion` 1 are supported. | [Data and backups](./operations/data) |
| Language and themes | PC, mobile monitor | English and Japanese, and 24 themes. | [Settings](./use/board#settings) |
| Agent CLI, JSON output, Hook, and `wait` | Claude Code, Codex | The Hook and the Skill must match the installed `agboard`; run `agboard update` after upgrading it. You start the agent yourself. | [Working with agents](./automation/agents) |
| `connect` and `update` | macOS, with Claude Code and Codex found on your `PATH` | Both commands are interactive, except `update --yes`. After the Hook changes, you trust it again in the agent. `update` never installs an older version. | [Working with agents](./automation/agents#connect-your-agent), [CLI reference](./automation/cli#connect-and-update) |
| First-run welcome | PC browser | It does not appear when the data area already has a project, and it does not appear on the mobile monitor. | [The first-run guide](./use/board#the-first-run-guide) |

## Features in public preview

### Docs {#docs}

The Docs dialog lets you browse and read the files in a project's `docs/` folder. The feature is still changing.

- **Supported range:** the board in a PC browser. The mobile monitor does not show Docs.
- **Limits:** a Markdown or MDX file can be up to 2 MiB, and an image up to 10 MiB.
- **Guide:** [Project docs](./use/docs).

### Task listening {#listen}

`agboard wait --until task` lets one open Claude Code or Codex session keep picking up AI tasks one after another.

- **Supported range:** Claude Code and Codex, following the procedure in the agent skill.
- **Limits:** it does not guarantee that two sessions will not pick the same task. A person starts the continuous run in the agent's session.
- **Guide:** [Listen for the next task](./automation/agents#listen-for-the-next-task).

### Mobile monitor {#mobile-monitor}

The mobile monitor shows the board on a phone and lets you answer an agent's question.

- **Supported range:** the browser of a smartphone, through ngrok.
- **Limits:** it depends on ngrok, and ngrok ends the HTTPS connection. It works only while your computer is on and `agboard serve` is running. The way it connects may change.
- **Guide:** [Mobile monitor](./operations/mobile-monitor).

## Related

- [Install and start](./getting-started)
