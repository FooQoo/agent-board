# AGENTS.md

## Repository conventions

- Keep source code, code comments, repository instructions, and the English README (`README.md`) in English. Localized UI resources and `README.ja.md` may use their target language; all other documentation remains in English.
- Keep implementation and tests in this repository.

## UI consistency

- Use the existing shadcn/ui Dialog and Button components for modal flows. Reuse the shared overlay and theme styles instead of implementing an independent modal shell.
- Verify archive layouts in a browser both before and after selecting a card. Check bulk confirmations with enough rows to scroll, in English and Japanese, light and dark themes, and narrow and desktop viewports.

## Portable paths and privacy

- Never commit machine-specific absolute paths to hooks, configuration, scripts, documentation, or generated artifacts. This includes personal home directories and local checkout paths.
- Use repository-relative paths for project files and executables, PATH for installed commands, or environment variables resolved at runtime. Keep machine-specific overrides in ignored local files.
- Before committing, inspect the staged diff for personal paths, including `/Users/` and `/home/`, and remove them. Verify that changed hook commands still work without depending on a particular user's directory layout.

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
- Tests must never touch the real data area (`~/Library/Application Support/agboard/` on macOS). Point `AGBOARD_HOME` at a temporary directory, for example `AGBOARD_HOME=$(mktemp -d)`.
- `agboard serve` listens only on `127.0.0.1`. Do not use the default port 7420 in tests; it is kept free for normal use. Use a port from your assigned range, or port 0.
