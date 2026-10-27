<div align="center">

<img src="web/public/logo.png" alt="Agent Board logo" width="120">

# Agent Board

**A shared work board where users and AI agents keep work moving together.**

AI agents register work for themselves and users. Users update tasks and answer decisions.

[日本語](README.ja.md) · [Usage guide](https://fooqoo.github.io/agent-board/guide/) · [Contributing](CONTRIBUTING.md) · [GitHub repository](https://github.com/FooQoo/agent-board)

![Local only](https://img.shields.io/badge/data-local%20only-1f6feb)
![Plain files](https://img.shields.io/badge/storage-plain%20files-1f6feb)
![macOS 15+](https://img.shields.io/badge/platform-macOS%2015%2B-1f6feb)

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

Agent Board runs on macOS 15 or later, on Apple Silicon and Intel. Install it with [Homebrew](https://brew.sh). You do not need Rust or Node.js, and you do not build anything.

```sh
brew install fooqoo/tap/agboard
agboard --version
```

Homebrew has its own requirements, such as the Command Line Tools on some Macs; see its documentation. To build from source, see the [developer guide](https://fooqoo.github.io/agent-board/dev/getting-started/setup).

## Connect

Create a project for your working folder, then connect your agents:

```sh
cd my-project
agboard project create "My project"
agboard connect
```

`project create` binds the current folder to the project; for an existing project, run `agboard project bind "My project"`. `connect` asks which agents to set up (Claude Code, Codex, or both) and where: one scope for the Skill and one for the Hook, Global or Project. It shows every change before it writes, keeps backups, and never overwrites your own edits. Afterwards, review the Hook with `/hooks` in your agent. See [Working with agents](https://fooqoo.github.io/agent-board/guide/automation/agents#connect-your-agent).

## Start

```sh
agboard serve
```

Open [http://127.0.0.1:7420/](http://127.0.0.1:7420/), select your project, and add a task. Most board commands use `--project NAME`; `agboard progress` and hooks resolve the project from the current folder unless explicitly overridden.

To check progress and answer questions from your phone, open **Settings** → **Mobile connection** and connect with your ngrok authtoken. The phone has to enter a 4-digit passcode that the board shows on your computer and that changes each time the connection starts; the full board stays on your computer. You can also start it with `NGROK_AUTHTOKEN` set and `agboard serve --monitor ngrok`, which prints the passcode. A 4-digit passcode is weaker than an account sign-in, so keep the address private; the [mobile monitor guide](https://fooqoo.github.io/agent-board/guide/operations/mobile-monitor) explains the limits.

## Update

Updating takes two steps. First update the command, then update the Skill and Hook that `connect` installed:

```sh
brew upgrade fooqoo/tap/agboard
agboard update
```

`agboard update` shows what will change and asks before it writes; `agboard update --yes` skips only the question and never overwrites your own edits. Restart `agboard serve` after an upgrade.

## Feature stages

Version 1.0.0 mixes generally available (GA) features and features in public preview. Docs, `connect` and `update`, task listening, the mobile monitor, and the first-run welcome are in public preview and may change. GA is not a promise that nothing changes or that nothing is broken. See [Feature stages](https://fooqoo.github.io/agent-board/guide/feature-stages).

## License

Agent Board is licensed under the [MIT License](LICENSE).
Bundled third-party components retain their respective licenses;
see [Third-party notices](THIRD_PARTY_NOTICES.txt).

## Documentation

- [Usage guide](https://fooqoo.github.io/agent-board/guide/) — browser operations, CLI examples, agent workflow, shared files, and backups.
- [Mobile monitor](https://fooqoo.github.io/agent-board/guide/operations/mobile-monitor) — connect a phone with ngrok and a passcode, what the monitor shows, and how to check it.
- [Release notes](https://fooqoo.github.io/agent-board/releases) — what each published version changes.
- [Claude Code and Codex integration](integrations/README.md) — what `connect` installs and how the hooks work.
- [Contributing](CONTRIBUTING.md) — development and verification.
