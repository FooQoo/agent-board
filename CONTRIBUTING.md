# Contributing to Agent Board

[日本語](CONTRIBUTING.ja.md)

## Build

Build the web UI first, then the CLI. The CLI embeds the built UI.

```sh
pnpm --dir web install
pnpm --dir web build
cargo build
```

The binary is `target/debug/agboard`.

## Install from source

Agents and hooks run `agboard` from your `PATH`, so install your build there:

```sh
pnpm --dir web install
pnpm --dir web build
cargo install --path . --locked --force
command -v agboard
```

Build the web UI first because the CLI embeds it. `cargo install` writes to `~/.cargo/bin` (or `$CARGO_HOME/bin`); that directory must be on your `PATH`. If `command -v agboard` prints nothing, add it, for example `export PATH="$HOME/.cargo/bin:$PATH"`, and open a new shell. After changing the code, run the three commands again to update the installed binary.

The installed `agboard` and a development build are separate files. Hook commands call the installed one, while `cargo build`, `cargo run`, and `target/debug/agboard` use the working tree. Reinstall before checking a change through a hook.

To try the installation without touching `~/.cargo/bin` or your board, install into a temporary root and use a temporary data area:

```sh
root="$(mktemp -d)"
cargo install --path . --locked --root "$root"
export SKAN_HOME="$(mktemp -d)"
"$root/bin/agboard" --help
"$root/bin/agboard" project create demo
"$root/bin/agboard" --project demo ls
```

## Development

Run all commands from the repository root.

Common workflows use `just`:

```sh
just dev          # sample board with Vite HMR (port 5173)
just build        # build the web UI, then the CLI
just serve        # saved board with Vite HMR and Rust watch (port 7420)
```

`just dev` watches web files and updates the browser through HMR. `just serve` requires Watchexec; install it with `cargo install --locked watchexec-cli`. It watches Rust files, restarts the Rust API when they change, and serves the web UI through Vite with HMR. Open `http://127.0.0.1:7420/`; the Rust API uses port 7421. The board comes from the normal saved location, or from `SKAN_HOME` if set. A Rust restart reloads the page to refresh its delete token.

Pass different ports as arguments, for example `just dev 5174` or `just serve 7500 7501` (web port, then Rust API port).

For manual CLI experiments and tests, point `SKAN_HOME` at a temporary directory so your saved board is not touched. The default data area is `~/Library/Application Support/skan/` on macOS and `%APPDATA%\skan\` on Windows.

```sh
export SKAN_HOME="$(mktemp -d)"
cargo run -- project create dev
cargo run -- --project dev add "Try it" --assignee ai --actor ai
cargo run -- serve --port <port>
```

The exported `SKAN_HOME` is shared by commands in this shell session. Set it again in a new session.

The data area holds `shared/` (the project folders as plain files), `serve.json` while a server runs, and the `lifecycle.lock` file. Nothing is stored in a database.

To work on the web UI alone with sample data:

```sh
pnpm --dir web dev --mode mock --port <port>
```

Verification commands:

```sh
pnpm --dir web install
pnpm --dir web build               # required before cargo build
cargo build
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
TZ=UTC cargo test
pnpm --dir web typecheck
pnpm --dir web check
TZ=UTC pnpm --dir web test
```

Run `pnpm --dir web format` to apply the web formatter.

Tests set `TZ=UTC` so displayed times are fixed. Tests never use the default data area: each one sets `SKAN_HOME` to a temporary directory. Do not use port 7420 in tests; it is kept free for normal use. In tests, connect to `http://127.0.0.1:<port>/` rather than `localhost`.
