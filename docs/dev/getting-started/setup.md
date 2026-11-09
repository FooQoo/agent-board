# Set up and run

Prepare your machine, build Agent Board (users install it with Homebrew; building from source is for development), run it against a temporary board, and install your build so that agents use it. Run every command from the repository root.

## Before you start

You need:

- A stable Rust toolchain (`cargo`).
- Node.js with `pnpm` (through Corepack).
- Optional: [`just`](https://github.com/casey/just) for the common workflows, and Watchexec (`cargo install --locked watchexec-cli`) for `just serve`.
- For end-to-end tests and screenshots: Playwright's Chromium (see [Documentation and images](../docs-and-images.md) for the install command). For demo videos: `ffmpeg`.

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
just docs         # VitePress documentation site (port 8662)
just storybook    # Storybook (port 8610)
just build        # build the web UI, then the CLI
just serve        # saved board with Vite HMR and Rust watch (port 7420)
```

- `just dev` serves sample data and updates the browser through HMR when web files change.
- `just docs` serves the documentation site at `http://127.0.0.1:8662/agent-board/`. Pass another port as an argument when needed, for example `just docs 8663`.
- `just storybook` serves the component and page Stories at `http://127.0.0.1:8610/`.
- `just serve` uses the real API. It restarts the Rust server when Rust files change and serves the UI through Vite with HMR. Open `http://127.0.0.1:7420/`; the Rust API uses port 7421. The board comes from the normal location, or from `AGBOARD_HOME` if set. A Rust restart reloads the page to refresh its write token.
- Pass other ports as arguments, for example `just dev 5174` or `just serve 7500 7501` (web port, then Rust API port).

To work on the web UI alone with sample data:

```sh
pnpm --dir web dev --mode mock --port <port>
```

The sample data starts like a new data area: the [first-run guide](../../guide/quickstart.md#before-you-start-the-first-run-guide) opens on the first page load, runs its two sample cards in memory, and can be skipped. Once it is finished or skipped, it stays closed until the dev server restarts or `POST /api/__mock/reset` restores the sample data.

For manual CLI experiments, use a temporary data area:

```sh
export AGBOARD_HOME="$(mktemp -d)"
cargo run -- project create dev
cargo run -- --project dev add "Try it" --assignee ai --actor ai
cargo run -- serve --port <port>
```

The data area holds `shared/` (the projects as plain files), `serve.json` while a server runs, and `lifecycle.lock`. Nothing is stored in a database. `task.json` holds a task's current state (`formatVersion: 1`), and `TASK.md` holds its body, acceptance conditions, and `at`/`reason` history; a file with any other `formatVersion` is reported as unsupported and never migrated. The [data model](../reference/files.md#files-on-disk) describes every file.

## Storybook

Storybook shows UI parts and complete pages with synthetic data. Its toolbar switches the language, light or dark mode, accent color, and width. Stories sit beside the parts they show, as `web/src/**/*.stories.tsx`; page-level Stories compose the same parts used by the application. The shared fixtures, decorators, and test adapters are in `web/.storybook/`.

```sh
just storybook
pnpm --dir web build-storybook
pnpm --dir web typecheck:storybook
TZ=UTC pnpm --dir web test:storybook
```

- `storybook` starts the dev server at `http://127.0.0.1:8610/`.
- `build-storybook` writes a static build to `web/storybook-static/`.
- `typecheck:storybook` type-checks the Stories and the Storybook setup.
- `test:storybook` runs two browser test projects in Chromium. One runs every Story, including its play function. The other runs the tests of the support code in `web/.storybook/`.

The width setting offers the desktop board at 1280px, and the phone monitor at 375px and 390px.

The Storybook build is separate from the app build. Storybook uses its own Vite configuration (`web/.storybook/vite.config.ts`), so the app's mock, live, and chunk settings do not apply to it. Storybook writes to `web/storybook-static/`, and the app writes to `web/dist/`.

Product code must not import a Story or anything under `web/.storybook/`. Only Stories and tests may use the shared support. `pnpm --dir web check` enforces this rule, and it applies the 300-line limit only to product files under `web/src`. A Story also refuses requests to the product API and its event stream, so a Story that calls them fails.

Synthetic images for Stories live in `web/.storybook/static/`. Storybook and the tests serve that folder from the root, so a Story can use a URL such as `/sample-attachment.png` without any setup.

Keep each part's `*.stories.tsx`, focused `*.test.tsx`, dedicated styles, and `story-coverage*.json` beside that part. A screen Story covers the composed page and its important page states; it does not replace Stories for the parts that own their own behavior. For example, `Pages/Board/Board` with the `ThreeLanes` export produces `pages-board-board--three-lanes`. Use typed `Meta`/`StoryObj` args to provide stable fixtures, and add a `play` function when a user interaction matters. Extend an existing Story file for that part instead of adding a duplicate.

A folder's `story-coverage.json` lists its source exports, the Stories that show them, and their states; use `story-coverage.<name>.json` when the folder already has a shared ledger. Each ledger must sit beside its parts, and listed Story IDs must be registered by a `*.stories.tsx` file in that folder. The format and rules are in `web/.storybook/support/component-coverage.json`. The Node check validates ledger entries and placement. The current inventory is still partial: it does not yet prove that every UI export has an entry. The `test:storybook` support checks that registered Story IDs and listed Story IDs match in both directions; the final UI-export inventory is a separate gate. Keep Story args synthetic and use the shared fixtures/adapters; the network guard rejects requests to the product API and event stream.

## Build release

Users install Agent Board with Homebrew (see [Install and start](../../guide/getting-started.md)). This section is for the people who build and publish a release. The workflow is `.github/workflows/release.yml` and the scripts are in `scripts/release/`.

### Archive and checks

- **Version.** `Cargo.toml` and `Cargo.lock` hold the version, and the tag is `v` plus that version. `scripts/release/check-version.py --tag vX.Y.Z` fails on any mismatch. The version on `main` is a development version; only a published GitHub Release is a released version.
- **Build.** Each CPU builds on its own macOS runner (`macos-15` for Apple Silicon, `macos-15-intel` for Intel), web UI first, then `cargo build --release --locked`, with `MACOSX_DEPLOYMENT_TARGET=15.0`. The minimum supported macOS is 15 on both CPUs. Strip, if any, runs before signing.
- **Archive.** `package.sh` writes `agboard-<version>-<target>.tar.gz` holding exactly `agboard`, `LICENSE`, and `THIRD_PARTY_NOTICES.txt`; the web UI, Skill, and Hook templates are inside the binary. `verify-artifact.sh` checks the names, the two license files, the CPU, the deployment target, that only system libraries are linked, and, where it can run, `--version` and the embedded web UI.
- **Notices.** `generate-notices.py` builds `THIRD_PARTY_NOTICES.txt`; `--check` fails when it is out of date. The MIT text is in `LICENSE`; its copyright line must hold the real holder and year before a release.
- **Actions.** Every `uses:` in `release.yml` is pinned to a full 40-character commit SHA with the version as a trailing comment (`actions/checkout@<sha> # v7.0.1`). When you update one, resolve the tag to its commit (the peeled commit for an annotated tag) and change the SHA and the comment together.
- **Candidate or release.** Pull requests and manual runs produce only an unsigned candidate (`candidate.json` says `signed: false`). A candidate is never a release file.

### Sign and notarize

The formal path runs only for a pushed or re-run `v*` tag, in the protected `release-signing` environment, the only place the signing secrets exist.

1. **Prepare once, by a person.** Enroll in the Apple Developer Program, create a Developer ID Application certificate with its private key, export it as a `.p12`, and create an App Store Connect API key (a `.p8` file with its Key ID and Issuer ID). Store these six secrets in the `release-signing` environment (not as repository secrets): `MACOS_CERT_P12`, `MACOS_CERT_PASSWORD`, `APPLE_TEAM_ID`, `APP_STORE_CONNECT_API_KEY` (the contents of the `.p8` file), `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`. Never write their values in the repository, an issue, or a log. Limit the environment to the trusted tags.
2. **Sign.** `sign-macos.sh` creates a temporary keychain under the job's temporary directory, imports the certificate, resolves exactly one Developer ID Application identity of the expected Team, and signs with `--options runtime --timestamp` and the fixed identifier `io.github.FooQoo.agent-board.agboard`. The certificate password never appears on a command line: `openssl` reads `MACOS_CERT_PASSWORD` from the environment, re-wraps the key and certificate into a temporary `.p12` protected by a random one-time passphrase, and only that passphrase is given to `security import -P`. The decrypted PEM is a 0600 file that is deleted right after re-wrapping. The first real run must confirm that macOS accepts the re-wrapped `.p12`. `verify-signature.sh` checks the Team ID, identifier, Hardened Runtime, secure timestamp, and that the designated requirement is the default one.
3. **Notarize.** `notarize-macos.sh` zips the signed binary (notarytool does not take a tar.gz), submits it with the App Store Connect API key, waits, and passes only on status `Accepted`. The key is written to a 0600 file in a temporary folder and passed to `notarytool` as `--key <path> --key-id <id> --issuer <uuid>`; the file is removed on every exit, and no secret value is on a command line. Invalid, rejected, timed out, or in progress is a failure. A timed-out submission can be continued by its ID instead of submitting again.
4. **Pack the same bytes.** The accepted binary goes into the tar.gz, and `release-gate.py` checks that the signed, notarized, and packed binaries are identical, that both CPUs share one Team ID, and then writes the archives and `SHA256SUMS`. The temporary keychain and key material are deleted in a step that always runs.
5. **Draft.** Only when both CPUs pass does a job create a draft GitHub Release and render the Formula candidate. A missing certificate, a rejected notarization, or one failing CPU stops the run; an unsigned archive is never a fallback.

A single command-line binary cannot carry a stapled ticket, so macOS checks the notarization online on first launch. Do not turn off Gatekeeper as part of any install step. Keep the same Team ID and identifier from release to release. When the certificate expires or is revoked, or the Apple credentials change, create a new certificate or API key and replace the secrets; a signature alone does not guarantee that stored Keychain permissions carry over, so check an upgrade on a clean Mac.

### Publish to Homebrew

After the Release is published: `scripts/release/render-formula.py --tag vX.Y.Z --sums SHA256SUMS --assets <dir> --out Formula/agboard.rb` renders the Formula from the published files and refuses a missing CPU, a wrong version, or a hash mismatch. The Formula selects the archive by CPU in `on_macos`, requires macOS 15 (`depends_on macos: :sequoia`), declares MIT, installs `agboard` into `bin` and the two license files into `pkgshare`, and has a `test do` block that checks `--version` and uses a temporary `AGBOARD_HOME`. `scripts/release/test-formula.sh` replays the install and test locally, and the Tap procedure is in its README. Nothing pushes to the `FooQoo/homebrew-tap` repository automatically; a person reviews the generated Formula and commits it.

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
