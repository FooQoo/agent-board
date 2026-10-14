---
title: Getting started
---

# Getting started

## Installation and updates

Follow [Install in the README](https://github.com/FooQoo/agent-board/blob/main/README.md#install) to build the web UI and install `agboard`. The prerequisites are Git, Rust with edition 2024 support, Node.js, and pnpm.

The installed command lives in `~/.cargo/bin`, or `$CARGO_HOME/bin` when `CARGO_HOME` is set. Check that your shell can find it:

```sh
command -v agboard
agboard --help
```

In PowerShell, use `Get-Command agboard`. If the command cannot be found, add Cargo's `bin` directory to your shell's `PATH` and open a new shell. For a default macOS installation, add `export PATH="$HOME/.cargo/bin:$PATH"` to your shell profile.

After pulling repository changes, rebuild and reinstall from the repository root:

```sh
pnpm --dir web install
pnpm --dir web build
cargo install --path . --locked --force
```

The CLI embeds the built web UI, so build the web UI first. `--force` replaces the installed version. Stop and restart `agboard serve` after an update to use the new executable and UI.

Hooks and the agent skill run `agboard` from `PATH`. A development build (`cargo build`, `cargo run`, or `target/debug/agboard`) is a separate executable; reinstall to make those changes available to hooks.

## Start a project

```sh
agboard project create "My project"
agboard serve --port 7420
```

Open [http://127.0.0.1:7420/](http://127.0.0.1:7420/) and select the project in the header. Keep the server running while using the browser or waiting for board changes. Press Ctrl+C in its terminal to stop it. The server listens only on `127.0.0.1`; choose another port with `--port` if needed.

![Agent Board in the browser with a project selected, showing cards in Todo, Doing, and Done](../images/board.png){.screenshot}

The board opens with the selected project in the header. Cards sit in the Todo, Doing, and Done columns.

Project creation, renaming, and deletion are CLI operations:

```sh
agboard project ls --json
agboard --project "My project" project rename "Website launch"
```

A rename preserves the project's ID, folder bindings, and cards. Update the name in commands that pass `--project` explicitly; folder-based progress and hooks continue to resolve the same project. `project rm` deletes the named project and its cards, asks for human confirmation, and is unavailable to agents.

Most commands take an explicit `--project NAME`. `agboard progress` and hooks resolve the nearest registered project folder; an explicit `--project` overrides that binding. Other commands do not infer a project from the browser or another agent.

The examples in this guide use `My project`; substitute your actual project name and the IDs returned by the CLI.

`project create` also binds the project to the current working folder. Use `--folder` for another existing folder, or `project bind` for an existing project:

```sh
agboard project create "Website launch" --folder ./website
agboard project bind "My project"
agboard project bind "My project" --folder ./docs
```

A folder belongs to one project; several folders can belong to the same project. Commands in subfolders use the nearest registered ancestor. A missing or broken binding returns an error instead of guessing another project. Bindings are local settings, separate from the portable shared files.
