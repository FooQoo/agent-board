# Code map

Where things live in the repository. For how the parts work together, read [How Agent Board works](../concepts/overview.md).

## Where the code lives

| Module | Responsibility |
| --- | --- |
| `main.rs` | Calls `cli::run()`. |
| `cli` | Arguments, commands, output formatting, and error display. |
| `file_store` | The shared-area format and everything that reads or writes it: paths, saving, locking, validation, operations, the index, and watching. |
| `docs` | The project docs: path rules (`paths`), the shared types (`model`), the tree, file and image reads (`reader`), the revision-checked save (`writer`), the revision (`revision`), and the README placed in a new `docs/` folder (`templates`). |
| `domain` | Tasks, lanes, run states, epics, decision requests, input limits, and rules.<br>No I/O. |
| `server` | The axum app, API, SSE, write guards, embedded web assets, and the monitor entry. |
| `agent` | The hook and `wait`. |
| `progress` | Builds the progress table shared by `agboard progress` and the hook. |
| `interact` | Human confirmation (terminal detection, y/N) and the notify client. |
| `setup` | Prepares agent access to the data area. |
| `paths`<br>`lifecycle`<br>`clock`<br>`error` | Data area resolution, the `serve` lock, UTC time, and `AgboardError` (code, exit code, message, reason). |

Dependencies point one way.

`cli` uses `agent`, `interact`, `server`, `setup`, and `progress`. `agent` uses `progress`; `agent`, `progress`, and `server` use `file_store`, which uses `domain`. `server` uses `docs`, which uses `file_store`'s `layout` and `io` for its paths and saves; `file_store` takes only `DocsLocale` from `docs`, to choose the README of a new `docs/` folder. 

`interact` and `setup` use only `paths` and `error`. Nothing depends on `cli`, and `server` does not depend on `cli`, `agent`, or `progress`. 

`domain` performs no I/O; its one reference to `file_store` is the `HistoryRecord` type alias.

Inside `file_store`, the pieces you will touch most often are:

| Module | Responsibility |
| --- | --- |
| `model` | Persistent serde types (`deny_unknown_fields`, camelCase, `formatVersion`). |
| `layout` | Builds owned paths only from validated IDs.<br>Strings never become paths directly. |
| `frontmatter`<br>`history`<br>`validate` | Split body and frontmatter, parse acceptance and history, and validate files while keeping unknown keys. |
| `transaction` | Saves and recovers the `task.json`/`TASK.md` pair with a durable journal. |
| `reader` | Combines JSON and Markdown into snapshots and `problems`. |
| `projection` | The Summary of a project, built from a parsed snapshot, and the change sets between two projections. It holds the versions of each task and epic. |
| `detail` | The data of one Detail stream, copied from a snapshot, and the NDJSON events built from it. Only the image headers are read from files. |
| `ops/` | Task, run state, answer, epic, image, and automatic completion operations. |
| `io`, `lock` | Replace-by-rename saves; `write.lock` and `lifecycle.lock`. |
| `project`, `bindings` | The project catalog and folder bindings. |
| `index`, `watch` | The in-memory index inside `serve`, and OS event watching. |

Inside `server`, routers depend on shared modules rather than on each other:

| Module | Responsibility |
| --- | --- |
| `api/` | The board router, its Host and write guards, and its handlers grouped by route: pages, projects, tasks, task edits, multipart, archive, task images, epics, epic images, project docs (`docs/`: `tree`, `file_get`, `file_put`, `assets`), and the mobile connection (`monitor_connections`). |
| `monitor/` | The monitor's read router, its answer endpoint, and its assets. |
| `monitor_connection/` | The ngrok mobile connection: the supervisor and its states (`lifecycle`, `start`, `run`), the saved settings (`config`), the token and its secure storage (`token`, `keychain`), the public-address contract and the ngrok endpoint, opened without a Traffic Policy (`contracts/`), the ngrok session (`backend`), and the entry checks that sit in front of the monitor (`router`, `entry`, with its `session` routes for the passcode unlock). |
| `preferences/` | The saved language and color theme: `preferences.json` in the internal area (`PreferencesStore`), the `GET` and `PUT` handling shared by the PC and the monitor, and the change notice. |
| `monitor_auth/` | The monitor's application sessions and CSRF tokens (`session`), the 4-digit passcode and its limit on wrong guesses (`passcode`), their header checks (`guard`), and constants such as the cookie name and 12-hour limit (`contracts`). |
| `guard` | Host, Origin, Sec-Fetch-Site and token checks for local writes and monitor writes, and canonical HTTPS origins. |
| `response`<br>`request` | The JSON error body, `AgboardError` to HTTP status mapping, and other shared responses; JSON bodies whose failures use that error body. |
| `store`<br>`answer` | Blocking file access, the index, and URL IDs for every router; saving an answer, shared by the board and the monitor. |
| `web_assets` | The embedded scripts and stylesheets of the board and the monitor, their build IDs, and the cacheable gzip or plain response. |
| `contracts/` | The data layer's wire types: the Summary, the Detail NDJSON lines, and the `changed` event. The golden examples in `tests/fixtures/data-layer/` pin their shapes. |
| `change_feed.rs` | Numbers each change set of this server run (`seq`, with an `instanceId` for the run) and holds the events a stream has not yet sent. A stream that falls too far behind gets `resync`. |
| `summary_response.rs`<br>`api/summary.rs`, `api/detail.rs`, `monitor/data.rs` | The Summary response with its `ETag`, and the Detail streams. The board and the monitor share the same builders. |

The main files and directories outside `src/` are:

- `build.rs`: embeds the built web UI and writes the asset tables and build IDs.
- `web/`: the Vite app. Its source in `web/src/` is split into `app/`, `pages/`, `features/`, and `shared/` (see [Where the web code lives](../concepts/server-and-ui.md#where-the-web-code-lives)).
- `src/domain/markdown_blocks.rs`: splits a body into top-level Markdown blocks for the Detail stream. It does no I/O.
- `web/src/shared/data/`: the data layer. `api/` holds the contract types and the Detail parser, `core/` the framework-free cache, scheduler, and event connection, and `react/` the hooks the screens use. See [Reading and updating data](../concepts/server-and-ui.md#reading-and-updating-data).
- `web/src/shared/markdown/`: the Markdown renderer. `MarkdownBlocks` draws the blocks of a body and virtualizes a large one (`VirtualMarkdown.tsx`).
- `web/src/shared/preferences/`: the saved language and color theme on the web side: the reads and saves, the browser's first-paint copy, and the `preferences` event. See [Server and web UI](../concepts/server-and-ui.md).
- `web/.storybook/`: Storybook configuration, synthetic fixtures, decorators, network guards, and support tests. UI Stories and coverage ledgers live beside the source they describe; see [Storybook setup and coverage](../getting-started/setup.md#storybook).
- `tests/`: Rust integration and CLI tests.
- `e2e/`: Playwright tests and the screenshot and video scripts.
- `docs/`: this documentation site.
- `integrations/`: hook templates.
- `.agents/skills/agent-board/`: the agent skill.

### Project docs

- `src/docs/`: paths, reads, the save, and the README templates (`templates/README.en.md`, `templates/README.ja.md`).
- `src/server/api/docs/`: the four routes on the board router.
- `src/file_store/project.rs`: creates `docs/` with a new project (`create_project_with_docs`) and fills it in at startup (`ensure_docs_dirs`).
- `web/src/features/docs/`: the request client (`api/docsApi.ts`), the tree, file and edit state (`model/`), and the dialog (`ui/DocsDialogContainer.tsx`, `ui/shell/` for the frame and file list, `ui/document/` for the body pane, front matter and conflict banner).
- `web/src/shared/markdown/frontmatter.ts` and `resolveRelativeImage.ts`: the front matter split and the relative image paths the dialog uses.
- `tests/docs_*.rs`: the Rust tests of the routes, reads, saves, README, and monitor boundary.

### First-run guide

- `src/file_store/onboarding_state.rs`: the state file, its lock, and the run's types.
- `src/file_store/onboarding_model.rs`: the sample identity and its checks.
- `src/file_store/ops/onboarding.rs`: the guide's operations.
- `src/server/api/onboarding.rs`: the guide's routes.
- `web/src/app/onboarding/`: the request client, the controller, and the layer.
- `web/src/features/onboarding/ui/`: the view parts.
- `e2e/tests/onboarding.spec.ts`: the end-to-end tests.

## Technology choices

<div class="technology-table">

| Purpose | Choice | Why |
| --- | --- | --- |
| Language | Rust (stable) | Types, ownership, and the compiler act as a harness for AI-written code. |
| CLI | clap (derive) | Standard subcommands, help, and validation. |
| Web server | axum<br>tokio | SSE and JSON APIs with little code. tokio also runs `wait`. |
| File watching | notify 8.2 | FSEvents on macOS and ReadDirectoryChangesW on Windows. Events are coalesced on tokio without a separate debouncer. |
| Frontmatter | serde_yaml_ng 0.10 | `serde_yaml` is deprecated and `serde_yml` unmaintained. Unknown keys are kept as `Value`. |
| JSON, time, hashing | serde / serde_json<br>chrono<br>sha2 | Shared types for output and the API; UTC storage; content versions. |
| Other Rust crates | dirs<br>thiserror<br>getrandom<br>reqwest + eventsource-stream<br>toml_edit<br>ngrok<br>keyring | Home directory, typed errors, random IDs and tokens, SSE for `wait`, comment-preserving TOML edits in `setup`, the in-process ngrok tunnel for the mobile monitor, and the OS credential store for a saved ngrok token. |
| UI | TypeScript<br>Vite<br>React | Typed UI state and API shapes. The build is embedded in the binary. |
| UI libraries | nuqs<br>shadcn/ui (Radix)<br>Tailwind CSS<br>lucide-react<br>i18next<br>@dnd-kit/react | URL state, accessible primitives, styling, icons, English and Japanese strings, drag and drop. |
| Markdown | react-markdown + remark-gfm<br>Milkdown Crepe 7.22<br>mermaid 12 | Rendering without raw HTML, WYSIWYG editing that round-trips to Markdown, strict-mode diagrams. |
| Tests | assert_cmd, predicates, tempfile<br>expectrl<br>Vitest, Testing Library<br>Playwright | CLI against temporary data areas, prompts in a pseudo-terminal, UI units and components, browser end to end. |
| Documentation | VitePress 1.6<br>mermaid 11 | A separate dependency tree in `docs/package.json`. |

</div>

Do not bulk-upgrade dependencies as part of an unrelated change. New dependencies resolve to compatible stable versions, pinned in `Cargo.lock` and `web/pnpm-lock.yaml`.
