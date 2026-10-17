# Verify and open a pull request

Before you open a pull request, follow the repository conventions, check UI changes in a browser, and run the verification commands.

## Conventions

Before you change behavior, read the [developer reference](../index.md) for the area you touch. Then follow these rules:

- Keep source code, code comments, repository instructions, and the English README (`README.md`) in English. Localized UI resources, `README.ja.md`, `CONTRIBUTING.ja.md`, and the Japanese documentation site pages under `docs/ja/**` may use their target language; English is the source, so update the Japanese translation in the same change. All other documentation remains in English.
- Keep implementation and tests in this repository.
- The developer reference in `docs/dev/reference/` describes how Agent Board works now. Update it, and its Japanese translation in `docs/ja/dev/reference/`, in the same change as the behavior it describes.
- Never commit machine-specific absolute paths to hooks, configuration, scripts, documentation, or generated artifacts, including personal home directories and local checkout paths.
- Use repository-relative paths for project files and executables, `PATH` for installed commands, or environment variables resolved at runtime. Keep machine-specific overrides in ignored local files.
- Before committing, inspect the staged diff for personal paths such as `/Users/` and `/home/`, and remove them. Check that changed hook commands work without depending on a particular user's directory layout.

## UI changes

- Use the existing shadcn/ui Dialog and Button components for modal flows. Reuse the shared overlay and theme styles instead of implementing an independent modal shell.
- Verify archive layouts in a browser both before and after selecting a task. Check bulk confirmations with enough rows to scroll, in English and Japanese, light and dark themes, and narrow and desktop viewports.

## Verification

Run these before you finish a change:

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

Rules for tests:

- Set `TZ=UTC` so displayed times are fixed.
- Never use the default data area: each test sets `AGBOARD_HOME` to a temporary directory.
- `agboard serve` listens only on `127.0.0.1`. Do not use port 7420; use an available port or port 0, and connect to `http://127.0.0.1:<port>/` rather than `localhost`.

The Playwright suites live in `e2e/`. Install them once with `pnpm --dir e2e install --frozen-lockfile` and `pnpm --dir e2e exec playwright install chromium`. `pnpm --dir e2e test` runs the app suite (its global setup builds the web UI and the CLI); `pnpm --dir e2e test:docs` runs the documentation site suite against a built site.
