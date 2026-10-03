# SimpleKanban

[日本語](README.ja.md)

A local kanban board for coding agents.

## What it is

SimpleKanban lets an agent manage cards from the command line (`skan`) while a human follows the progress in a browser.

- The CLI (`skan`) is for agents, and humans can use it too. It creates and edits cards, moves them between columns, reports whether a card is running or pending, and lists, shows, exports, and imports them.
- The web view (`skan serve`) is for humans only. It shows the board, updates automatically, and can delete a card.
- The board has three columns: Todo, Doing, and Done. Only cards in Doing have a run state: idle, running, or pending.
- Everything is stored locally in a SQLite database. Nothing leaves your machine, and `skan serve` listens only on `127.0.0.1`.

## Language

The web UI opens in English. Use the globe button in the header to choose English or Japanese; the selection is saved in your browser. The interface does not choose a language from your browser or operating system settings. The CLI, its help and errors, and API and JSON values remain in English. Card content that you enter is not translated.

## Build

Build the web UI first, then the CLI. The CLI embeds the built UI.

```sh
pnpm --dir web install
pnpm --dir web build
cargo build
```

The binary is `target/debug/skan`.

## Usage

```sh
skan init --name my-board          # create the board
skan add "Write the setup guide"   # add a card to Todo
skan mv 1 doing                    # move card #1 to Doing
skan state 1 running               # report that card #1 is running
skan state 1 pending --reason "Waiting for review"
skan ls                            # list cards by column
skan ls --column doing --state running
skan serve --port 7420             # show the board in your browser
```

Other commands: `edit`, `show`, `rm`, `export`, and `import`. Run `skan --help` or `skan <command> --help` for details.

- Add `--json` to any command for machine-readable output.
- Deleting a card (`rm`), re-running `init` on an existing board, and `import` over an existing board ask a human to confirm. Agents cannot do them.

## Rules for agents

The same rules appear in `skan --help`.

```text
Rules for agents:
  - Move a card to doing before you report running or pending.
  - Report pending with --reason when you are waiting for something.
  - Moving a card to todo or done resets it to idle.
  - You cannot delete cards or replace the board. Ask a human to do it.
  - Add --json to any command for machine-readable output.
```

## Development

Run all commands from the repository root.

Always point `SKAN_HOME` at a temporary directory when you run or test the CLI, so your real board is never touched. The default data area is `~/Library/Application Support/skan/` on macOS and `%APPDATA%\skan\` on Windows.

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
TZ=UTC pnpm --dir web test
```

Tests set `TZ=UTC` so displayed times are fixed. Do not use port 7420 in tests; it is kept free for normal use. In tests, connect to `http://127.0.0.1:<port>/` rather than `localhost`.
