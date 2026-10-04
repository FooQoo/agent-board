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
cargo run -- init --name dev
cargo run -- serve --port <port>
```

The exported `SKAN_HOME` is shared by commands in this shell session. Set it again in a new session.

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

Tests set `TZ=UTC` so displayed times are fixed. Do not use port 7420 in tests; it is kept free for normal use. In tests, connect to `http://127.0.0.1:<port>/` rather than `localhost`.
