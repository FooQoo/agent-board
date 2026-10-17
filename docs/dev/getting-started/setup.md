# Set up and run

Prepare your machine, build Agent Board, run it against a temporary board, and install your build so that agents use it. Run every command from the repository root.

## Before you start

You need:

- A stable Rust toolchain (`cargo`).
- Node.js with `pnpm` (through Corepack).
- Optional: [`just`](https://github.com/casey/just) for the common workflows, and Watchexec (`cargo install --locked watchexec-cli`) for `just serve`.
- For end-to-end tests and screenshots: Playwright's Chromium (installed below). For demo videos: `ffmpeg`.

Two habits keep your own board safe while you work:

- **Use a temporary data area.** The default data area (`~/.agent-board/` on macOS, `%USERPROFILE%\.agent-board\` on Windows) is your real board. For experiments and tests, set `AGBOARD_HOME` to a temporary directory. The variable applies to the current shell only.
- **Leave port 7420 free.** It is the default port for normal use. Use another port, or port 0 in tests.

## Build

The CLI embeds the built web UI, so build the UI first:

```sh
pnpm --dir web install
pnpm --dir web build
cargo build
```

The binary is `target/debug/agboard`. If `cargo build` stops with `Run "pnpm --dir web build" first.`, the UI build is missing.

## Development

Common workflows use `just`:

```sh
just dev          # sample board with Vite HMR (port 5173)
just build        # build the web UI, then the CLI
just serve        # saved board with Vite HMR and Rust watch (port 7420)
```

- `just dev` serves sample data and updates the browser through HMR when web files change.
- `just serve` uses the real API. It restarts the Rust server when Rust files change and serves the UI through Vite with HMR. Open `http://127.0.0.1:7420/`; the Rust API uses port 7421. The board comes from the normal location, or from `AGBOARD_HOME` if set. A Rust restart reloads the page to refresh its write token.
- Pass other ports as arguments, for example `just dev 5174` or `just serve 7500 7501` (web port, then Rust API port).

To work on the web UI alone with sample data:

```sh
pnpm --dir web dev --mode mock --port <port>
```

For manual CLI experiments, use a temporary data area:

```sh
export AGBOARD_HOME="$(mktemp -d)"
cargo run -- project create dev
cargo run -- --project dev add "Try it" --assignee ai --actor ai
cargo run -- serve --port <port>
```

The data area holds `shared/` (the projects as plain files), `serve.json` while a server runs, and `lifecycle.lock`. Nothing is stored in a database. `task.json` holds a task's current state (`formatVersion: 1`), and `TASK.md` holds its body, acceptance conditions, and `at`/`reason` history; a file with any other `formatVersion` is reported as unsupported and never migrated. The [data model](../reference/files.md#files-on-disk) describes every file.

## Install from source

Agents and hooks run `agboard` from your `PATH`, so to try a change through an agent, install your build:

```sh
pnpm --dir web install
pnpm --dir web build
cargo install --path . --locked --force
command -v agboard
```

`cargo install` writes to `~/.cargo/bin` (or `$CARGO_HOME/bin`), which must be on your `PATH`. If `command -v agboard` prints nothing, add it, for example `export PATH="$HOME/.cargo/bin:$PATH"`, and open a new shell.

The installed `agboard` and your development build are separate files. Hooks call the installed one, while `cargo build`, `cargo run`, and `target/debug/agboard` use the working tree. Reinstall before checking a change through a hook.

To try an installation without touching `~/.cargo/bin` or your board:

```sh
root="$(mktemp -d)"
cargo install --path . --locked --root "$root"
export AGBOARD_HOME="$(mktemp -d)"
"$root/bin/agboard" --help
"$root/bin/agboard" project create demo
"$root/bin/agboard" --project demo ls
```
