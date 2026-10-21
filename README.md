<div align="center">

<img src="web/public/logo.png" alt="Agent Board logo" width="120">

# Agent Board

**A shared work board where users and AI agents keep work moving together.**

AI agents register work for themselves and users. Users update tasks and answer decisions.

[日本語](README.ja.md) · [Usage guide](https://fooqoo.github.io/agent-board/guide/) · [Contributing](CONTRIBUTING.md) · [GitHub repository](https://github.com/FooQoo/agent-board)

![Local only](https://img.shields.io/badge/data-local%20only-1f6feb)
![Plain files](https://img.shields.io/badge/storage-plain%20files-1f6feb)
![macOS and Windows](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-1f6feb)

<img src="docs/images/board.png" alt="Current desktop board with a question on its task, acceptance counts, and four detail tabs" width="860">

</div>

## What is Agent Board?

When an agent works for a long time, you need to see what is moving, what is waiting, and what response will unblock it. Agent Board gives users and agents one shared, history-backed board.

```mermaid
flowchart LR
    A["AI agent"] -- "agboard CLI + hooks" --> D[("Local shared folder")]
    U["User"] -- "Agent Board UI" --> D
    D -- "local server" --> B["Browser"]
```

## Features

**1. One board for people and AI agents.** Track work in Todo, Doing, and Done, with Running and Pending states showing what the agent is doing. Answer questions directly on a task from your PC or phone, and keep decisions and status changes in its history.

**2. Keep one agent session moving through tasks.** Order tasks within an epic and let `agboard progress` return the work that can advance, together with the paths to its plans and tasks. An agent can explicitly listen for the next eligible task with `agboard --project "My project" wait --until task --idle-timeout 300 --json`; it processes one task, then listens again in the same session. Existing Todo tasks and idle AI tasks already in Doing are included, and the command exits normally after the chosen idle interval. Folder-based project selection and hooks give agents the right context. When every acceptance condition is verified, eligible AI tasks move to Done automatically; completed work stays read-only for agents.

**3. Local Markdown for plans and results.** Keep epic details in `EPIC.md` and tasks in `TASK.md`, with images alongside them. A task's plan and verification results live in the `TASK.md` body, with acceptance conditions and history in its frontmatter; task metadata such as its current status lives in `task.json`. Each history entry has just a timestamp (`at`) and content (`reason`). Agents record meaningful work progress automatically, and UI or CLI operations add their own history. You may supply a reason or let Agent Board generate one from the current state. Everything stays in your local data area, with no account or hosted service required.

See the [usage guide](https://fooqoo.github.io/agent-board/guide/) for editing, attachments, archiving, and settings.

<details>
<summary>Epic progress and mobile drawer screenshots</summary>

<img src="docs/images/epic.png" alt="Epic editor with a scrollable task progress panel and a full-height Markdown plan" width="860">

<img src="docs/images/mobile.png" alt="Mobile bottom drawer with Body, Conditions, History, and Epic tabs" width="300">

</details>

## Install

Build from source with Git, Rust (Cargo with edition 2024 support), Node.js, and pnpm:

```sh
git clone https://github.com/FooQoo/agent-board.git
cd agent-board
pnpm --dir web install
pnpm --dir web build
cargo install --path . --locked --force
```

Keep `~/.cargo/bin` (or `$CARGO_HOME/bin`) on your `PATH`. Build the web UI before installing: `agboard` embeds it. See the [usage guide](https://fooqoo.github.io/agent-board/guide/getting-started) for updates and installation checks.

## Get started

```sh
agboard project create "My project"
agboard serve --port 7420
```

Open [http://127.0.0.1:7420/](http://127.0.0.1:7420/), select your project, and add a task. Most board commands use `--project NAME`; `agboard progress` and hooks resolve the project from the current folder unless explicitly overridden.

## Documentation

- [Usage guide](https://fooqoo.github.io/agent-board/guide/) — browser operations, CLI examples, agent workflow, shared files, and backups.
- [Mobile monitor](https://fooqoo.github.io/agent-board/guide/mobile-monitor) — what the monitor shows and how to check it on a phone.
- [Claude Code and Codex integration](integrations/README.md) — hooks and agent setup.
- [Contributing](CONTRIBUTING.md) — development and verification.
