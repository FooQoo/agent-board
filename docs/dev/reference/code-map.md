# Code map

Where things live in the repository. For how the parts work together, read [How Agent Board works](../concepts/overview.md).

## Where the code lives

| Module | Responsibility |
| --- | --- |
| `main.rs` | Calls `cli::run()`. |
| `cli` | Arguments, commands, output formatting, and error display. |
| `file_store` | The shared-area format and everything that reads or writes it: paths, saving, locking, validation, operations, the index, and watching. |
| `domain` | Tasks, lanes, run states, epics, decision requests, input limits, and rules.<br>No I/O. |
| `server` | The axum app, API, SSE, write guards, embedded web assets, and the monitor entry. |
| `agent` | The hook and `wait`. |
| `progress` | Builds the progress table shared by `agboard progress` and the hook. |
| `interact` | Human confirmation (terminal detection, y/N) and the notify client. |
| `setup` | Prepares agent access to the data area. |
| `paths`<br>`lifecycle`<br>`clock`<br>`error` | Data area resolution, the `serve` lock, UTC time, and `AgboardError` (code, exit code, message, reason). |

Dependencies point one way.

`cli` uses `agent`, `interact`, `server`, `setup`, and `progress`. `agent` uses `progress`; `agent`, `progress`, and `server` use `file_store`, which uses `domain`. 

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
| `ops/` | Task, run state, answer, epic, image, and automatic completion operations. |
| `io`, `lock` | Replace-by-rename saves; `write.lock` and `lifecycle.lock`. |
| `project`, `bindings` | The project catalog and folder bindings. |
| `index`, `watch` | The in-memory index inside `serve`, and OS event watching. |

Inside `server`, routers depend on shared modules rather than on each other:

| Module | Responsibility |
| --- | --- |
| `api/` | The board router, its Host and write guards, and its handlers grouped by route: pages, projects, tasks, task edits, multipart, archive, task images, epics, epic images, and the mobile connection (`monitor_connections`). |
| `monitor/` | The monitor's read router, its answer endpoint, and its assets. |
| `monitor_connection/` | The ngrok mobile connection: the supervisor and its states (`lifecycle`, `start`, `run`), the saved settings (`config`), the token and its secure storage (`token`, `keychain`), the public-address contract and the ngrok endpoint, opened without a Traffic Policy (`contracts/`), the ngrok session (`backend`), and the entry checks that sit in front of the monitor (`router`, `entry`, with its `session` routes for the passcode unlock). |
| `monitor_auth/` | The monitor's application sessions and CSRF tokens (`session`), the 4-digit passcode and its limit on wrong guesses (`passcode`), their header checks (`guard`), and constants such as the cookie name and 12-hour limit (`contracts`). |
| `guard` | Host, Origin, Sec-Fetch-Site and token checks for local writes and monitor writes, and canonical HTTPS origins. |
| `response`<br>`request` | The JSON error body, `AgboardError` to HTTP status mapping, and other shared responses; JSON bodies whose failures use that error body. |
| `store`<br>`answer` | Blocking file access, the index, and URL IDs for every router; saving an answer, shared by the board and the monitor. |
| `web_assets` | The embedded scripts and stylesheets of the board and the monitor, their build IDs, and the cacheable gzip or plain response. |

The main files and directories outside `src/` are:

- `build.rs`: embeds the built web UI and writes the asset tables and build IDs.
- `web/`: the Vite app. Its source in `web/src/` is split into `app/`, `pages/`, `features/`, and `shared/` (see [Where the web code lives](../concepts/server-and-ui.md#where-the-web-code-lives)).
- `web/.storybook/`: Storybook configuration, synthetic fixtures, decorators, network guards, and support tests. UI Stories and coverage ledgers live beside the source they describe; see [Storybook setup and coverage](../getting-started/setup.md#storybook).
- `tests/`: Rust integration and CLI tests.
- `e2e/`: Playwright tests and the screenshot and video scripts.
- `docs/`: this documentation site.
- `integrations/`: hook templates.
- `.agents/skills/agent-board/`: the agent skill.

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
