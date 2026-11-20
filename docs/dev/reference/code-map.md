# Code map

Where things live in the repository. For how the parts work together, read [How Agent Board works](../concepts/overview.md).

## Where the code lives

| Module | Responsibility |
| --- | --- |
| `main.rs` | Calls `cli::run()`. |
| `cli` | Arguments, commands, output formatting, and error display. |
| `file_store` | The shared-area format and everything that reads or writes it: paths, saving, locking, validation, operations, the index, and watching. |
| `docs` | The project docs: path rules (`paths`), the shared types (`model`), the tree, file and image reads (`reader`), the revision of a file's content (`revision`), and the README placed in a new `docs/` folder (`templates`). |
| `domain` | Tasks, lanes, run states, epics, questions, input limits, and rules.<br>No I/O. |
| `server` | The axum app, API, SSE, write guards, embedded web assets, and the ngrok entrance. |
| `agent` | The hook and `wait`. |
| `autostart` | Starting the shared server when a command needs it: the check, `autostart.lock`, the detached `serve --auto` child (`spawn`), and the `autostart.paused` marker. |
| `progress` | Builds the progress table shared by `agboard progress` and the hook. |
| `interact` | Human confirmation (terminal detection, y/N), the notify client, and opening a board page in the browser (`browser`: the board address, when no browser is opened, and the platform's opener). |
| `setup` | Installs and updates the Agent Board plugin and prepares agent access to the data area. |
| `paths`<br>`lifecycle`<br>`clock`<br>`error` | Data area resolution, the `serve` lock, UTC time, and `AgboardError` (code, exit code, message, reason). |

Dependencies point one way.

`cli` uses `agent`, `autostart`, `interact`, `server`, `setup`, and `progress`. `agent` and `cli` use `autostart`, which uses `server` and `file_store`. `agent` uses `progress`; `agent`, `progress`, and `server` use `file_store`, which uses `domain`. `server` uses `docs`, which uses `file_store`'s `layout` and `io` for its paths and read errors; `file_store` takes only `DocsLocale` from `docs`, to choose the README of a new `docs/` folder. 

`interact` and `setup` use only `paths`, `error`, and `domain`; `interact::browser` also asks `autostart` whether it runs in the `agboard` command line. `server` uses `interact::browser` for the platform's opener of the Docs route. Nothing depends on `cli`, and `server` does not depend on `cli`, `agent`, or `progress`. 

`domain` performs no I/O; its one reference to `file_store` is the `HistoryRecord` type alias.

Inside `file_store`, the pieces you will touch most often are:

| Module | Responsibility |
| --- | --- |
| `model` | Persistent serde types (`deny_unknown_fields`, camelCase, `formatVersion`). |
| `layout` | Builds owned paths only from validated IDs.<br>Strings never become paths directly. |
| `frontmatter`<br>`history`<br>`validate` | Split body and frontmatter, parse acceptance and history, and validate files while keeping unknown keys. |
| `transaction` | Saves and recovers the `task.json`/`TASK.md` pair with a durable journal, and saves several files together with the batch journal (`batch.rs`). |
| `message.rs` | The common shape of questions and requests (`Message`, the `MessageSource` trait, and the `Question` and `Request` types) and the `messages` list of the Summary. |
| `qa/` | Messages: the question and request models (`model.rs`), reading and writing `QA.md` (`codec.rs`), the rules a file must meet (`check.rs`), where messages live and how they are read (`store.rs`), the state derived for tasks (`derive.rs`), and the views callers receive (`view.rs`). |
| `reader` | Combines JSON and Markdown into snapshots and `problems`. |
| `projection` | The Summary of a project, built from a parsed snapshot, and the change sets between two projections. It holds the versions of each task and epic. |
| `detail` | The data of one Detail stream, copied from a snapshot, and the NDJSON events built from it. Only the image headers are read from files. |
| `ops/` | Task, run state, message (`qa/`: ask, answer, send, accept, withdraw, link, read, and the one-time conversion of the old format, `migrate.rs`), a person's acceptance check, epic, image, and automatic completion operations. |
| `io`, `lock` | Replace-by-rename saves; `write.lock` and `lifecycle.lock`. |
| `project`, `bindings` | The project catalog and folder bindings. |
| `index`, `watch` | The in-memory index inside `serve`, and OS event watching. |

Inside `server`, routers depend on shared modules rather than on each other:

| Module | Responsibility |
| --- | --- |
| `api/` | The board router (`router`, and `remote_router` for the ngrok entrance, without the local guards and local-only routes), its Host and write guards (`guards`), and its handlers grouped by route: pages, projects, tasks, task edits, a person's acceptance check (`task_acceptance`), multipart, archive, task images, epics, epic images, project docs (`docs/`: `tree`, `file_get`, `assets`, `open`), and the remote connection (`monitor_connections`). |
| `monitor_connection/` | The ngrok remote connection: the supervisor and its states (`lifecycle`, `restore`, `start`, `run`), the saved settings (`config`; the command line saves through `src/remote_settings.rs`), the token and its secure storage (`token`, `keychain`), the public-address contract and the ngrok endpoint, opened without a Traffic Policy (`contracts/`), the ngrok session (`backend`), and the entry checks that sit in front of the board (`router`, `entry`, with its `session` routes for the passcode unlock). |
| `notification_settings/` | Which notifications the phone receives: `notification-settings.json` in the internal area (`NotificationSettingsStore`), the kinds, the summary interval, and defaults, and the `GET` and `PUT` handling of `/api/notification-settings`. |
| `preferences/` | The saved language and color theme: `preferences.json` in the internal area (`PreferencesStore`), the `GET` and `PUT` handling of `/api/preferences`, and the change notice. |
| `monitor_auth/` | The entrance's application sessions and CSRF tokens (`session`), the 4-digit passcode and its limit on wrong guesses (`passcode`), their header checks (`guard`), and constants such as the cookie name and 12-hour limit (`contracts`). |
| `guard` | Host, Origin, Sec-Fetch-Site and token checks for local writes. |
| `response`<br>`request` | The JSON error body, `AgboardError` to HTTP status mapping, and other shared responses; JSON bodies whose failures use that error body. |
| `store`<br>`qa`<br>`acceptance` | Blocking file access, the index, and URL IDs for every router; reading messages, saving answers, and sending and withdrawing requests (`messages.rs`; `api/messages.rs` holds the board's handlers), and setting one acceptance condition as a person. |
| `web_assets` | The embedded scripts and stylesheets of the board, its build ID, and the cacheable gzip or plain response. |
| `contracts/` | The data layer's wire types: the Summary, the Detail NDJSON lines, and the `changed` event. The golden examples in `tests/fixtures/data-layer/` pin their shapes. |
| `launch`<br>`bind`<br>`idle` | Starting one server and ending it (`launch`); listening and what a failure to listen means, with the port holder and the free-port fallback (`bind`); what counts as use and the idle stop of an automatic server (`idle`). |
| `change_feed.rs` | Numbers each change set of this server run (`seq`, with an `instanceId` for the run) and holds the events a stream has not yet sent. A stream that falls too far behind gets `resync`. |
| `summary_response.rs`<br>`api/summary.rs`, `api/detail.rs` | The Summary response with its `ETag`, and the Detail streams. |

The main files and directories outside `src/` are:

- `build.rs`: embeds the built web UI and writes the asset tables and build IDs.
- `web/`: the Vite app. Its source in `web/src/` is split into `app/`, `pages/`, `features/`, and `shared/` (see [Where the web code lives](../concepts/server-and-ui.md#where-the-web-code-lives)).
- `src/domain/markdown_blocks.rs`: splits a body into top-level Markdown blocks for the Detail stream. It does no I/O.
- `web/src/shared/data/`: the data layer. `api/` holds the contract types and the Detail parser, `core/` the framework-free cache, scheduler, and event connection, and `react/` the hooks the screens use. See [Reading and updating data](../concepts/server-and-ui.md#reading-and-updating-data).
- `web/src/shared/lib/gesture/sortableDrag.ts`: the drag gesture and drop logic shared by every list that sorts cards across groups: the board's lanes and the waves of the epic editor. `cardSensors` (with `cardActivationConstraints` and `GRIP_CLASS`) gives the whole card as the draggable, a touch on the grip starts at once, and a touch elsewhere holds briefly so a swipe still scrolls. `dropPlacement` reads a finished drag as a group, an index among the other items of it, and whether the item stayed. Each sortable names its group with `useSortable({ group })` and each drop area with `data.group`.
- `web/src/features/epics/editor/`: the epic dialog. `waveModel.ts` holds the pure wave operations (`normalizeWaves`, `moveTask`, `moveWave`, `waveStatuses`), `EpicProgressList.tsx` the drag context and the drop handling, `WaveRow.tsx` a wave (its header, its handle, and its row of cards), `WaveTask.tsx` a card, and `useEpicEditor.ts` the editor state that saves `waves`. See [Order the work](../../guide/watch/epics.md#order-the-work).
- `web/src/shared/markdown/`: the Markdown renderer. `MarkdownBlocks` draws the blocks of a body and virtualizes a large one (`VirtualMarkdown.tsx`).
- `web/src/features/notification-settings/`: the "Phone notifications" row of the settings dialog and the dialog it opens, with its reads, saves, and the same kinds and defaults as the server.
- `web/src/shared/preferences/`: the saved language and color theme on the web side: the reads and saves, the browser's first-paint copy, and the `preferences` event. See [Server and web UI](../concepts/server-and-ui.md).
- `web/.storybook/`: Storybook configuration, synthetic fixtures, decorators, network guards, and support tests. UI Stories and coverage ledgers live beside the source they describe; see [Storybook setup and coverage](../getting-started/setup.md#storybook).
- `tests/`: Rust integration and CLI tests.
- `e2e/`: Playwright tests and the screenshot and video scripts.
- `docs/`: this documentation site.
- `plugins/agent-board/`: the Agent Board plugin: the manifests, the thin entry of the `agent-board` skill in `skills/agent-board/`, the `remote` skill in `skills/remote/`, the `wait` skill in `skills/wait/`, and the Hook of each agent in `hooks/`.
- `.agents/plugins/marketplace.json` and `.claude-plugin/marketplace.json`: the marketplace catalogs of Codex and Claude Code.

### Plugin setup and update

- `src/setup/`: `mod.rs` (the agents and options), `prepare.rs` (the read-only plan), `execute.rs` (carrying it out), and `report.rs` (the text and JSON result and the exit code). `plan.rs`, `codex.rs`, and `claude.rs` compute the settings changes, and `apply.rs` with `apply/files.rs` writes them with backups. `env.rs` resolves the paths, `agent_cli.rs` runs the agents' commands, `plugin.rs` installs the plugin from the marketplace, and `trust.rs` trusts the Codex hooks through `codex app-server`.
- `src/cli/commands/setup.rs`: `agboard setup` and `agboard update`: the options, the agent choice, and the confirmation question. `setup_remote.rs` is `agboard setup remote` and the optional remote access step of `setup`; `remote.rs` is `agboard show remote`; `src/cli/run/remote.rs` runs both when no project store is needed. `src/remote_settings.rs` is the shared validation and storage of the saved ngrok settings.
- `src/nudge/`: the reminders of what agents forget. `mod.rs` has the rule registry types and the two ways to run it (`state_reminders` for the progress table, `turn_end_reminders` for the Stop hook), `rules.rs` the `RULES` list, `turn.rs` the transcript reader for Claude Code and Codex, `cases.rs` the test cases of every rule, and `coverage.rs` the table that maps every command and progress field to its rules. The Stop hook itself is `src/agent/stop/`. See [Nudge rules](../concepts/agents.md#nudge-rules).
- `src/skills/`: the text of the `agent-board` skill (`agent-board.md`, `topics/`) that `agboard skills` prints.
- `src/plugin_hash.rs`, `src/setup/auto_update.rs`, and `src/setup/auto_update/`: the content hash of the plugin (computed by `build.rs`), and the hook's automatic update with its lock and record. `tests/plugin_auto_update.rs` and `tests/skills_command.rs` test them.
- `tests/setup.rs` and `tests/setup_plugin.rs`: setup and update against fake agent commands (`tests/support/fake_agents.rs`). `tests/plugin_layout.rs` checks the marketplace and plugin files and their versions.
- `src/cli/commands/message/` and `src/cli/args/message.rs`: the `agboard message` commands, their JSON input (`input.rs`), and the JSON Lines events of `message ask` and `message wait` (`stream.rs`). The wait itself is `src/agent/message_wait.rs`, built on the shared wait engine.
- `web/src/features/tasks/messages/`: the list of messages. `model/messages.ts` holds the tabs, the counts, and `canSendAnswer`, `api.ts` reads a message and sends answers and withdrawals, `MessageBand.tsx` is the band with the counts (shared by the PC board and the phone screen), `MessageCenter.tsx` joins the band and the list, `MessageRows.tsx` draws the rows, and `MessagesSurface.tsx` is the list, the question, and the request in a modal or a bottom sheet. `web/src/features/tasks/answer/` draws the question and the answer fields (`DecisionQuestion`, `DecisionAnswerFields`), and `web/src/app/model/useMessagesController.ts` wires the list to the PC board.
- `web/src/features/messages/ask/`: the **Ask AI** composer (`AskAiDialog.tsx`, `AskAiToolbar.tsx`) and `sendRequest.ts`, which builds the multipart request.
- The board (`pages/board/ui/Lane.tsx`) and the phone monitor (`pages/monitor/components/MonitorLanes.tsx`) draw AI-draft tasks as ordinary cards with a draft badge. There is no plan card, plan review, or start route in the web UI.
- `web/src/pages/monitor/`: the phone screen. `View.tsx` composes the header, the lane tabs, the lanes, and the bottom bar (`components/PhoneNav.tsx` and `components/PhoneNavBar.tsx`). `components/LaneTabs.tsx` is the tab bar with the counts, `components/MonitorLanes.tsx` is the lane carousel (`hooks/useLaneCarousel.ts` follows the finger), `components/SwipeableCard.tsx` with `hooks/useCardGesture.ts` is the hold-to-choose and slide-open gesture of a card (built on `web/src/shared/lib/gesture/useSideSwipe.ts`), and `components/MonitorLaneDialogs.tsx` holds the archive and bulk archive confirmations. `model/lanes.ts` holds the lane order and the buttons a swipe shows, and `hooks/useLaneOverlay.ts` keeps what this phone saved on screen until the next read. `components/MonitorLanesScreen.tsx` composes the same parts for Storybook. `web/src/shared/viewport/stableHeight.ts` keeps the page height while the software keyboard is open.
- `scripts/release/` and `.github/workflows/release.yml`: the release archive, signing, notarization, and Formula (see [Build release](../getting-started/setup.md#build-release)).

### Project docs

- `src/docs/`: paths, reads, and the README templates (`templates/README.en.md`, `templates/README.ja.md`).
- `src/server/api/docs/`: the four routes on the board router.
- `src/server/push_delivery/`: Web Push delivery of board changes (`events.rs`: compare what tasks showed before and after a change, and choose one notification per task; `message.rs`: the text and link; `webpush.rs`: RFC 8291 encryption and the RFC 8292 signature; `transport.rs`: the `PushTransport` trait and its `reqwest` implementation; `ledger.rs`: `.internal/push-ledger.json`; `deliver.rs`: sending and retrying; `runtime.rs`: the task that follows the change feed; `summary.rs`: the periodic summary schedule and its notification). The summaries themselves are stored by `src/file_store/notify.rs` and served by `src/server/api/summaries.rs`. See [Web Push delivery](../concepts/notifications.md#web-push-delivery).
- `src/server/resident/`: the launcher of headless Claude Code and Codex sessions, and the only code that knows those CLIs (`cli.rs`: names, login check, models, arguments, environment scrubbing; `mod.rs`: the launcher, stop, shutdown; `driver/`: the `AgentDriver` trait and its events, `ClaudeDriver` (two-way stream-json), and `CodexDriver` (JSON-RPC with `codex app-server`; the conversation is in `codex_parse.rs` and `codex_inbound.rs`); `spawn.rs`: starting a session through a driver, reading its events, and running its pusher; `push/`: push mode (`mod.rs`: the pusher's state and one look at the board, `decide.rs`: what to send and the retry policy); `board.rs`: where the boards are, waking the pusher on a change, and the launched session as the sessions list shows it; `supervisor.rs` and `watch.rs`: restarts, the unhealthy check, auto-start at server start; `health.rs`: the health the API reports; `autostart.rs`: `.internal/resident-autostart.json`). Its routes are in `src/server/api/sessions.rs`.
- `src/server/sessions/`, `src/server/api/sessions.rs`, and `src/agent/session_identity.rs`: the in-memory registry of attached agent sessions, its read route, and how a waiting command names its session.
- `src/file_store/project.rs`: creates `docs/` with a new project (`create_project_with_docs`) and fills it in at startup (`ensure_docs_dirs`).
- `web/src/features/resident-sessions/`: the resident-session dialog, its settings row, and the footer indicator. `api.ts` is the client of the sessions routes, `state.ts` derives the badge state (`working`, `waiting`, `restarting`, `stopped`, `failed`) from the `health` object, `useResidentSession.ts` polls the sessions route, `useResidentController.ts` runs the dialog's choices, Start, Stop, and auto-start, and `ui/` draws the dialog (`ResidentView.tsx`, `ResidentDialog.tsx`), the row, and the indicator. `web/src/app/residentSlot.tsx` decides where they exist. For what users see, read the [Resident session guide](../../guide/delegate/resident-session.md).
- `web/src/features/docs/`: the request client (`api/docsApi.ts`), the tree, the chosen file, and following changes on disk (`model/`), and the dialog (`ui/DocsDialogContainer.tsx`, `ui/shell/` for the frame and file list, `ui/document/` for the body pane, front matter, file viewer and MDX frame).
- `web/src/shared/markdown/frontmatter.ts` and `resolveRelativeImage.ts`: the front matter split and the relative image paths the dialog uses.
- `tests/docs_*.rs`: the Rust tests of the routes, reads, README, sandbox, and ngrok entrance.

### First-run guide

- `src/file_store/onboarding_state.rs`: the state file, which records only whether the guide was seen.
- `src/server/api/onboarding.rs`: the guide's two routes.
- `web/src/app/onboarding/`: the request client, the controller, the sample cards and question, the sample answer form, and the layer.
- `web/src/app/development/mock-server/guide.ts`: the demo's two guide routes.
- `web/src/features/onboarding/ui/`: the view parts.
- `e2e/tests/onboarding.spec.ts`: the end-to-end tests.
- `web/src/app/dialogs/TaskPreviewDialog.tsx`: the task preview's server wiring: entering and leaving the draft, reading the card again, and the running and archived states.
- `web/src/app/model/useStreamSubscriptions.ts`: the change subscriptions that the previews and the Docs dialog follow.
- `e2e/tests/preview-modal.spec.ts`: the preview's end-to-end tests.

### Browser demo

- `web/src/app/development/mock-server/`: the sample-data server without Node APIs, shared by the sample-data mode (`web/mock-api.ts`) and the demo. `sampleJa.ts` holds the Japanese text of the sample boards.
- `web/src/app/development/demo/`: the demo's start (`install.ts`), the `fetch` and `EventSource` replacement (`transport.ts`), and the image rewrite (`images.ts`), and the starting language (`locale.ts`).
- `web/demo-build.ts`: the `demo` mode's Vite plugin, its base path, and the sample data it gives the page.
- `e2e/playwright.demo.config.ts` and `e2e/demo/`: the demo suite, run against the built documentation site. See [The browser demo](../concepts/demo.md).

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
| Other Rust crates | dirs<br>thiserror<br>getrandom<br>reqwest + eventsource-stream<br>toml_edit<br>ngrok<br>keyring | Home directory, typed errors, random IDs and tokens, SSE for `wait`, comment-preserving TOML edits in `setup`, the in-process ngrok tunnel for remote access, and the OS credential store for a saved ngrok token. |
| UI | TypeScript<br>Vite<br>React | Typed UI state and API shapes. The build is embedded in the binary. |
| UI libraries | nuqs<br>shadcn/ui (Radix)<br>Tailwind CSS<br>lucide-react<br>i18next<br>@dnd-kit/react | URL state, accessible primitives, styling, icons, English and Japanese strings, drag and drop. |
| Markdown | react-markdown + remark-gfm<br>Milkdown Crepe 7.22<br>mermaid 12 | Rendering without raw HTML, WYSIWYG editing that round-trips to Markdown, strict-mode diagrams. |
| Tests | assert_cmd, predicates, tempfile<br>expectrl<br>Vitest, Testing Library<br>Playwright | CLI against temporary data areas, prompts in a pseudo-terminal, UI units and components, browser end to end. |
| Documentation | VitePress 1.6<br>mermaid 11 | A separate dependency tree in `docs/package.json`. |

</div>

Do not bulk-upgrade dependencies as part of an unrelated change. New dependencies resolve to compatible stable versions, pinned in `Cargo.lock` and `web/pnpm-lock.yaml`.
