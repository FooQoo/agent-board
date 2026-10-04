# AGENTS.md

## Repository conventions

- Keep source code, code comments, repository instructions, and the English README (`README.md`) in English. Localized UI resources and `README.ja.md` may use their target language; all other documentation remains in English.
- Keep implementation and tests in this repository.

## Verification

Run these from the repository root before you finish a change. Build the web UI first, because the Rust build embeds it.

```sh
pnpm --dir web install
pnpm --dir web build
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
TZ=UTC cargo test
pnpm --dir web typecheck
pnpm --dir web check
TZ=UTC pnpm --dir web test
```

- Set `TZ=UTC` for tests so displayed times are fixed.
- Tests must never touch the real data area (`~/Library/Application Support/skan/` on macOS). Point `SKAN_HOME` at a temporary directory, for example `SKAN_HOME=$(mktemp -d)`.
- `agboard serve` listens only on `127.0.0.1`. Do not use the default port 7420 in tests; it is kept free for normal use. Use a port from your assigned range, or port 0.
