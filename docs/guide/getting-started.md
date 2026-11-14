---
title: Install and start
---

# Install and start

By the end of this page, `agboard` is installed with Homebrew, your working folder has a project, your agents are set up, and the board is open in your browser. Then continue with the [Quickstart](./quickstart).

The steps are: install, create or bind a project, set up your agents, and start the server.

## Before you begin

- A Mac running macOS 15 or later, with Apple Silicon or an Intel processor.
- [Homebrew](https://brew.sh). Homebrew has its own requirements, such as the Command Line Tools on some Macs; follow the Homebrew documentation for them.
- For the setup step, Claude Code or Codex on your `PATH` (the `claude` or `codex` command), and a network connection to GitHub.

You do not build Agent Board yourself. The Homebrew package is a prebuilt command with the web UI inside, so you do not need Rust, Node.js, or pnpm, and you do not clone the repository. To build from source, see [Set up and run](../dev/getting-started/setup).

## Install

```sh
brew install fooqoo/tap/agboard
agboard --version
```

The command is signed with a Developer ID certificate and notarized by Apple. If macOS refuses to run it, do not turn off Gatekeeper; see [Troubleshooting](./operations/troubleshooting#macos-will-not-run-agboard).

Agent Board is released under the MIT License. The license and the notices for bundled third-party components are installed in `share/agboard` under your Homebrew prefix (`$(brew --prefix)/share/agboard`).

## Create or bind a project

Go to the folder you work in. A project belongs to the folder it is bound to, and its subfolders use the same project. You do this once for each folder.

```sh
cd my-project
agboard project create "My project"
```

`project create` makes the project and binds the current folder to it. If the project already exists, bind this folder to it instead:

```sh
agboard project bind "My project"
```

For renaming projects and registering other folders, see [Data and backups](./operations/data#projects-and-folders).

## Set up your agents

```sh
agboard setup
```

`setup` asks which agents you use, shows the plan, and after you answer `y` installs the Agent Board plugin (the Skill and the Hook) for Claude Code, Codex, or both. You run it once on your computer; it works in any folder. See [Set up your agents](./automation/agents#set-up-your-agents) for what it asks, what it changes, and what to do afterwards.

## Start the board

Start the server:

```sh
agboard serve
```

Open [http://127.0.0.1:7420/](http://127.0.0.1:7420/) and select the project in the header. Press Ctrl+C in its terminal to stop it. You do not have to keep it running for agents: a waiting command and the agent hook start a server in the background when none runs, and that server stops by itself after 30 minutes without use. To keep a server running in the background instead, use `agboard serve -d`. The server listens only on `127.0.0.1`; choose another port with `--port` if 7420 is taken.

![Agent Board in the browser with a project selected, showing tasks in Todo, Doing, and Done](../images/board.png){.screenshot}

The board opens with the selected project in the header. Tasks sit in the Todo, Doing, and Done columns.

Most commands name the project explicitly with `--project NAME`. The examples in this guide use `My project`; replace it with your project's name, and use the task IDs that the CLI returns. For renaming projects and registering folders, see [Data and backups](./operations/data#projects-and-folders).

## Update

Update the command with Homebrew, then bring the Agent Board plugin to the same version:

```sh
brew upgrade fooqoo/tap/agboard
agboard --version
agboard update
```

`brew upgrade` replaces the command and the web UI inside it. It does not change the plugin in your agents. `agboard update` does that, for every agent that has the plugin. It shows what will change and asks for confirmation; `agboard update --yes` answers the question in advance. See [Update the plugin](./automation/agents#update-the-plugin).

Stop and restart `agboard serve` after an upgrade to use the new command and UI. Open boards and monitors reload themselves once the server is back, after you finish any edit or answer in progress.

If you forget, a new agent session tells you: when the plugin and the command differ, the agent asks you to run `agboard update`.

Hooks and the agent Skill run `agboard` from your `PATH`, so they use the installed version. A development build (`cargo build`, `cargo run`, or `target/debug/agboard`) is a separate executable.

## Next

- [Quickstart](./quickstart): take one task from creation to Done.
- [Working with agents](./automation/agents): what `setup` asks, and how agents work on the board.
- [Feature stages](./feature-stages): which features are generally available and which are in public preview.
