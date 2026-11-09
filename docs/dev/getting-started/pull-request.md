# Verify and open a pull request

Before you open a pull request, follow the repository conventions, check UI changes in a browser, and run the verification commands.

## Conventions

Before you change behavior, read the [developer reference](../index.md) for the area you touch. Then follow these rules:

- Keep source code, code comments, repository instructions, and the English README (`README.md`) in English. Localized UI resources, `README.ja.md`, `CONTRIBUTING.ja.md`, and the Japanese documentation site pages under `docs/ja/**` may use their target language; English is the source, so update the Japanese translation in the same change. All other documentation remains in English.
- Keep implementation and tests in this repository.
- Keep each production source file within 300 lines: `src/**/*.rs`, and `.ts` and `.tsx` under `web/src/`. Tests and styles have no limit.
  - Rust: `tests/file_size.rs` counts the lines before a file's `#[cfg(test)]` module.
  - Web UI: Biome's `noExcessiveLinesPerFile` rule in `web/biome.json` checks the files, so `pnpm --dir web check` reports them. The same command then checks the import layers and cycles of `web/src/` (see [Where the web code lives](../concepts/server-and-ui.md#where-the-web-code-lives)).
  - A file that must stay longer says so on its first line, with a reason: `// file-size: allow (reason)` in Rust, and `// biome-ignore lint/style/noExcessiveLinesPerFile: reason` in the web UI. Such a file has no limit, so prefer splitting it by responsibility. The Rust test also fails when a marker has no reason, or when its file fits the limit.
- The developer reference in `docs/dev/reference/` describes how Agent Board works now. Update it, and its Japanese translation in `docs/ja/dev/reference/`, in the same change as the behavior it describes.
- Never commit machine-specific absolute paths to hooks, configuration, scripts, documentation, or generated artifacts, including personal home directories and local checkout paths.
- Use repository-relative paths for project files and executables, `PATH` for installed commands, or environment variables resolved at runtime. Keep machine-specific overrides in ignored local files.
- Before committing, inspect the staged diff for personal paths such as `/Users/` and `/home/`, and remove them. Check that changed hook commands work without depending on a particular user's directory layout.

## UI changes

- Use the existing shadcn/ui Dialog and Button components for modal flows. Reuse the shared overlay and theme styles instead of implementing an independent modal shell.
- Size buttons only through the shared parts: the `size` of `Button`, `DialogActions` for the buttons that end a dialog or a confirm, `IconLabel` for an icon with its text, and `ConfirmPanel` for a confirm inside a panel. A stylesheet rule with `cursor: pointer` that gives itself a fixed `px` height or width is reported by Biome (`web/biome-plugins/no-fixed-clickable-size.grit`), in the editor and in `pnpm --dir web check`. A rule that must keep a fixed size (a list row, a slider) says why in a comment before the declaration: `/* biome-ignore lint/plugin: reason */`.
- Verify archive layouts in a browser both before and after selecting a task. Check bulk confirmations with enough rows to scroll, in English and Japanese, light and dark themes, and narrow and desktop viewports.

## Verification

Run these before you finish a change:

```sh
pnpm --dir web install
pnpm --dir web build               # required before cargo build
cargo build
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
TZ=UTC cargo nextest run
pnpm --dir web typecheck
pnpm --dir web check
TZ=UTC pnpm --dir web test
pnpm --dir web typecheck:storybook
TZ=UTC pnpm --dir web test:storybook
pnpm --dir web build-storybook
```

Run `pnpm --dir web format` to apply the web formatter. To measure coverage locally, run `pnpm --dir web test:coverage` for the web UI (the report goes to `web/coverage/`) and `cargo llvm-cov nextest` for Rust ([cargo-llvm-cov](https://github.com/taiki-e/cargo-llvm-cov) is installed with `cargo install cargo-llvm-cov --locked`).

The [CI workflow](https://github.com/FooQoo/agent-board/blob/main/.github/workflows/ci.yml) runs the same checks on every pull request and every push to `main`:

- The Rust job runs `cargo fmt`, `cargo clippy`, and `cargo nextest run` on macOS 15.
- The web job runs the type checks, the linter, the unit tests, and the Storybook tests and build.
- The E2E job runs the Playwright app suite (`pnpm --dir e2e test`) on macOS 15. It takes about 15 minutes, so it runs on pushes to `main` and on manual runs, not on pull requests.
- The coverage job measures the Rust tests with `cargo llvm-cov nextest` and the web unit tests with `pnpm --dir web test:coverage`, then sends both reports to [Codecov](https://codecov.io/gh/FooQoo/agent-board). It reports the numbers and does not fail the run for a low coverage.

Check that the Rust and web jobs pass before you merge, and run `pnpm --dir e2e test` locally when the change affects the app. When the E2E job fails on `main`, its traces are attached to the run as the `e2e-results` artifact.

The Rust tests run with [cargo-nextest](https://nexte.st/) (`cargo install cargo-nextest --locked`). Each test runs in its own process, and `.config/nextest.toml` stops a test that runs longer than two minutes. `TZ=UTC cargo test` still works, but it runs each test binary's tests in one process and has no time limit.

Rules for tests:

- Set `TZ=UTC` so displayed times are fixed.
- Never use the default data area: each test sets `AGBOARD_HOME` to a temporary directory.
- A test that starts `agboard serve` sets `AGBOARD_WATCH=poll`, and an embedded server is started with `server::run_until_in` and `WatchMode::Poll`. Only `tests/file_watch.rs` uses the platform's file events.
- `agboard serve` listens only on `127.0.0.1`. Do not use port 7420; use an available port or port 0, and connect to `http://127.0.0.1:<port>/` rather than `localhost`.

The Playwright suites live in `e2e/`. Install them once with `pnpm --dir e2e install --frozen-lockfile` and `pnpm --dir e2e exec playwright install chromium`. `pnpm --dir e2e test` runs the app suite (its global setup builds the web UI and the CLI); `pnpm --dir e2e test:docs` runs the documentation site suite against a built site.

The app suite runs its spec files on several Playwright workers at once:

- Each worker has its own temporary data area and its own `agboard serve` on port 0. The suite uses no fixed port, so two checkouts can run it at the same time.
- The number of workers defaults to half the CPUs. Set `AGBOARD_E2E_WORKERS`, or pass `--workers`, to change it. The tests in one file run in order on one worker, because they share that worker's board.
- `AGBOARD_E2E_BINARY` selects a different `agboard` binary. The worker fixture sets `AGBOARD_E2E_HOME` and `AGBOARD_E2E_MAIN_URL` itself; do not set them.
- Results and traces go to `agent-board-e2e-results-<checkout>` in the system's temporary directory, one folder for each checkout.

When you write an app spec:

- Import `test` and `expect` from `e2e/helpers/fixtures`, not from `@playwright/test`, so the spec uses the worker's server and its `baseURL`.
- Call `mainUrl()`, `mainOrigin()`, and `mainHome()` inside a test or a hook, not when the file loads.
- A spec that needs its own server starts it with `startServe(home)` and reads the port from the result; passing the same port restarts the server on it. Playwright resolves `baseURL` before `beforeAll` runs, so start the server from whichever needs it first, as `states.spec.ts` does. Image servers from `startImageServer()` also use port 0.
- `resetBoard` waits until the worker's server shows the restored board, so a page opened right after it loads the fixture.
