# Server and web UI

`agboard serve` serves the board to browsers: a JSON API, live updates, and the React app embedded in the binary. This page covers how requests are handled, how the UI is built, and how the UI behaves when something fails. The endpoints are in [Web API](../reference/web-api.md).

## Starting and stopping serve

A data area has at most one server. It runs in one of two modes, recorded as `mode` in `serve.json`:

- **Automatic.** A command that cannot work without a server starts one in the background: `wait --after`, `wait --until task`, `message ask` unless `--no-wait`, and `message wait` for an open question. The agent hook starts one too, without waiting. The server stops by itself after it has gone unused.
- **Manual.** A person runs `agboard serve` (in the foreground) or `agboard serve -d` (in the background). It runs until Ctrl+C or `agboard stop`.

Every other command works on the files alone and starts nothing.

### Starting

- `serve` listens only on `127.0.0.1` and works with zero projects; it may create `workspace.json` in an empty data area.
- `lifecycle.lock` (a standard `try_lock`) is held from start to exit so that only one server runs per data area. The file existing does not mean a server is running; the lock is released when the process exits. An automatic server waits up to 10 seconds for a server that is still shutting down to release it.
- At startup, if `serve.json` exists and `GET /api/health` on its port returns the same `pid`, `serve` exits with `already_serving`. Otherwise the file is stale and is overwritten. When the running server is automatic, the reason says to run `agboard serve -d` to keep it.
- `serve -d` makes the same check first. If the running server is automatic and the command gives no `--port` or `--monitor` that differs from it, `serve -d` sends it SIGUSR1: the same process records `mode: "manual"`, stops counting idle time, and keeps every connection. Otherwise, for a person at a terminal, it offers to stop the running server through the `stop` path and start a new one; with `--json` or without a terminal it exits with `already_serving`.
- `serve` writes `serve.json` (`pid`, `port`, `started_at`, `mode`, and `idleTimeoutSeconds` for an automatic server) after it starts listening. On SIGINT or SIGTERM it removes `serve.json` only if the file holds its own pid.

### How a command starts a server

1. The command reads `serve.json`. If its server answers the health check, the command uses it.
2. If the pid in `serve.json` is alive and still holds `lifecycle.lock` but does not answer, the command waits up to 10 seconds in case it is starting or stopping, then fails with `board_unavailable` naming the pid. It never starts a second server. A connection the OS or a sandbox refuses is `local_network_denied` instead.
3. Otherwise the command takes `autostart.lock`, waiting up to 40 seconds for another command that is starting a server, and checks again.
4. It runs `agboard --json serve --auto` as a new session (`setsid`), with the data area as its working directory and standard output and error in `serve.log` (truncated at each start, mode 0600). The child inherits the open `autostart.lock` and releases it once it is ready, so no other command starts a second server meanwhile.
5. The command waits up to 30 seconds for the startup line in `serve.log`, then prints one line on standard error and continues. Standard output stays the command's own.

```text
Started the Agent Board server at http://127.0.0.1:7420/ in the background. It stops by itself after 30 minutes without use.
```

If the connection fails after a command has read `serve.json`, for example because the server stopped in between, the command starts a server once more. The hook starts the server without waiting: it only checks that the pid in `serve.json` is alive and that `autostart.lock` is free, and it starts nothing after `agboard stop` (see below). Failures are left in `serve.log`.

`AGBOARD_AUTOSTART=0` turns all of this off: commands report `board_unavailable` as before, and the hook starts nothing. The library never starts a server by itself; only the `agboard` command line does.

### Opening the board

An automatic server opens the board of the project it was started for, once. The user-facing rules are in the [CLI reference](../../guide/reference/cli.md#open-the-board-in-the-browser).

- The command that starts the server passes the project ID as the hidden `serve --auto --open-board=<projectId>`: a waiting command passes the project it follows, `message ask` and `message wait` the project of the questions, and the hook the project of the progress table it printed. `agboard open` passes none, because it opens the page itself.
- Once the server is ready and has released `autostart.lock`, a thread waits 3 seconds (`AGBOARD_OPEN_GRACE_MS` changes it for the tests, up to 60,000 ms). Then it opens `http://127.0.0.1:<port>/?project=<projectId>` unless a board page has connected since the start. A tab that connected and closed again still counts, because it may reconnect.
- A board page is a `GET /api/events` stream without the `X-Agboard-Wait` header. The waiting commands send that header, so their own stream, which opens right after the start, is not taken for a tab. A phone's page through the ngrok entrance is the same stream behind the session and counts the same way.
- `src/interact/browser.rs` decides whether a browser can be opened, in this order: `AGBOARD_OPEN_BROWSER=0` opens nothing; `AGBOARD_BROWSER_OPENER` names a program that replaces the system's opener; `SSH_CONNECTION` or `SSH_TTY` opens nothing; on systems other than macOS and Windows, no `DISPLAY` and no `WAYLAND_DISPLAY` opens nothing. Otherwise it runs `open` (macOS), `explorer` (Windows), or `xdg-open`, with the address as its only argument and no shell, and does not wait for it.
- The outcome is one line in `serve.log`: `Opened … in the browser.`, `Did not open … in the browser.` with the reason, or `Could not open …` when the program could not be started.
- Like starting a server, only the `agboard` command line opens a browser; the library embedded in a test never does. The tests set `AGBOARD_OPEN_BROWSER=0`, and the tests of opening point `AGBOARD_BROWSER_OPENER` at a script that records the address.

### Ports

- A manual server listens on `--port` (7420 by default) and nothing else. A taken port is `port_in_use`, and the reason names what holds it: another Agent Board server (with its pid) whose data area is different, or another program.
- An automatic server tries 7420 first (`AGBOARD_AUTOSTART_PORT` changes it; tests use 0). When it is taken, the server listens on a port the OS chooses and prints why, for example `Port 7420 is used by another program, so this server uses port 52114.`
- A refusal by the OS or a sandbox (`EACCES` or `EPERM`) is `local_network_denied`. Any other failure to listen is `board_unavailable` with the OS message.

### Stopping by itself

An automatic server is in use while any of these is true:

- a request other than `GET /api/health` arrived within the idle time;
- an event stream (`GET /api/events`) is open: a browser tab, a `wait`, or a question that waits (the waiting commands mark theirs with the `X-Agboard-Wait` header, see [Opening the board](#opening-the-board));
- the remote access connection is starting, ready, reconnecting, or stopping;
- the file watcher saw a change to the board or the Docs within the idle time, so an agent that edits files keeps the server running for automatic Done.

The idle time is 30 minutes; `AGBOARD_IDLE_TIMEOUT` sets it from 60 to 86400 seconds. The check runs every 30 seconds on a monotonic clock. When the server has been unused for the idle time, it removes `serve.json` first (so a new command starts a new server instead of connecting to this one), answers new requests with `503 board_unavailable`, ends the monitor connection, releases `lifecycle.lock`, and writes `Stopped after 30 minutes without use.` to `serve.log`.

### stop

`stop` sends SIGTERM to the `pid` in `serve.json`, whichever mode it runs in. It returns only after the port stops answering and `lifecycle.lock` can be taken, so a `serve` started right after it does not fail with `database_busy`. A server still shutting down after 10 seconds makes `stop` fail.

`stop` also leaves `autostart.paused` in the data area, so the hook does not start the server again right away. A command that waits, `serve`, or `serve -d` removes it and starts a server.

## Handling a request

Every request goes through the same steps:

1. **Host check.** Only `127.0.0.1:<port>` or `localhost:<port>` is accepted.
2. **Write guard** (writes only). `Origin`, `Sec-Fetch-Site: same-origin`, and `X-Agboard-Token` must all match (see [Security model](./security.md#writes-from-the-browser)). Guards run **before** the target is looked up, so a forged request learns nothing about what exists.
3. **The operation.** Reads come from the in-memory index. Writes take the project write lock, read the latest files, commit `task.json` and `TASK.md` as one pair, and trigger a reload and notification only when something changed (see [Storage and consistency](./saving-and-recovery.md#saving-a-task)).

Writes always target the ProjectId in the URL. The web `actor` is always `human`; it is never taken from the request. There are no unscoped routes such as `/api/board`, no compatibility aliases, and no HTTP API for creating, renaming, or deleting projects.

The [project docs](../reference/web-api.md#project-docs) routes are an exception to step 3: they read files in the project's `docs/` folder directly, without the index or the project write lock, and they never write. The open route runs on a blocking thread, because starting a program may touch the disk.

JSON and HTML responses are `no-store`. Scripts and stylesheets are named by their content and sent with `Cache-Control: public, max-age=31536000, immutable`, gzip-compressed when the browser accepts gzip; a new build changes the names the HTML loads, so a reload always gets the current UI. HTML responses carry `Referrer-Policy: no-referrer` and a `Content-Security-Policy`: scripts and connections from self only; styles from self and `'unsafe-inline'` (the editor injects `<style>` at runtime); images from self, `data:`, `http`, and `https`.

## How the web UI is built

- `web/` is a Vite, TypeScript, and React app. nuqs keeps the requested project in the URL (`useQueryState('project', parseAsString)`); `useBoard` fetches, subscribes, and loads per project; one `useReducer` coordinates the applied project, pending switches, task selection, and dialogs. Component inputs use `useState`. No other state or form library is added.
- The initial selection replaces history, the menu pushes, and back and forward follow the nuqs adapter. There is no direct History API use or custom `popstate` handling.
- One app serves both layouts. `useNarrowViewport` (`web/src/shared/lib/viewport/useNarrowViewport.ts`) follows `matchMedia('(max-width: 767px)')`, so a resize switches the screen live. Below 768px `App` draws the phone screen (`web/src/app/mobile/MobileBoard.tsx`, loaded on first need so the board's first load is unchanged) in place of `BoardWorkspace`; at 768px and above it draws the PC board. The first-run guide runs in both layouts; see [The first-run guide](#the-first-run-guide). For the screen as users see it, see [The board](../../guide/watch/board.md#narrow-windows-and-phones).
- The phone screen (`MonitorScreen`, `web/src/pages/monitor/MonitorProject.tsx`) takes its dependencies from the app: where attachments are read and which acceptance write it uses (`MonitorReadResolvers`), where the language and theme are saved (`PreferencesEndpoint`), how a message is read, how answers and withdrawals are written (`MessagesApi`), and the project switcher for the header. The board app gives the board's own routes and the page's credential, the token or, through the ngrok entrance, the session's CSRF token (`web/src/app/mobile/boardEnvironment.ts`). There is no second app: the old monitor's own entry and build are gone.
- The phone screen shows one lane at a time. `LaneTabs` and `MonitorLanes` share the lane on screen, so a tap on a tab and a swipe of the carousel agree, and only the lane on screen takes touches (the other two are `inert`). A card slides only after a hold has chosen it (`SwipeableCard`); a sideways move on any other card belongs to the carousel. The cards write nothing themselves: a lane button opens the move dialog, the archive button the archive confirmation, and the Done lane's **Archive all** the bulk confirmation, and the screen asks for the write only after the person confirmed. With writes available the screen sends them through the board's routes and `useLaneOverlay` keeps the result on screen until a read shows it; without them (the demo, sample data) a swipe asks nothing and changes nothing. For the screen as users see it, see [Remote access](../../guide/watch/remote-access.md#switch-lanes).
- `watchStableHeight` (`web/src/shared/viewport/stableHeight.ts`, started in `web/src/app/entry/board.tsx`) keeps `--stable-vh` on the root at the page height from before the software keyboard opened. A shrink of the viewport while a text field has the focus is taken as the keyboard and ignored; any other change (a rotation, a resized window, the browser's toolbar) is followed. CSS uses `--stable-vh` with `svh` as the fallback, so the board is not squashed into the strip above the keyboard. While the kept height is taller than the viewport, the root carries `data-keyboard`, and CSS moves centered dialogs to the top and keeps the phone bottom sheet's top on screen, so the field being typed in stays above the keyboard.
- A single controller (`useAppController`) stays above the width switch. The active project, the Summary the data layer holds, the stream, and the open state of the list of messages (`useMessagesController`) belong to it, and both screens read them. A project chosen on either screen is the project on the other. The drawer, the list of messages and the scroll position belong to a screen and start again. The dialogs of `AppDialogs` stay mounted, so a form that is open when the window narrows is not lost.
- `pnpm --dir web build` emits `index.html`, the entry script and stylesheet `assets/app-[hash].js` and `assets/app-[hash].css`, the editor and Mermaid as dynamic chunks `assets/chunk-[name]-[hash].js`, and, from a second Vite build, the Docs sandbox script. The board build also writes `chunk-graph.json`, its chunks with their imports, `web/src/` modules, and packages. Its last step writes a `.gz` beside every script and stylesheet.
- The first script holds only what the first screen needs. The card, epic, bulk-archive and settings dialogs, the Markdown renderer of the detail panel, and the phone screen's detail drawer are split out with `preloadable` (`web/src/shared/lib/lazy/preloadable.ts`) and fetched right after the first screen is shown; a description shows its plain text until the renderer arrives. The editor's outline reads `##` headings with the viewer's Markdown parser, so CodeMirror loads only with the editor.
- `web/test/build-contract.test.ts` keeps a budget for the board's first load (the entry and the chunks it imports statically) and requires every script over 500 kB to load on use only. Vite's `chunkSizeWarningLimit` is raised to 1500 kB for those on-use chunks: Mermaid's ELK layout, its grammar parser, and the rich editor.
- Rust embeds both logos, the HTML templates, and the `.gz` files. `build.rs` lists the scripts and stylesheets of the board in tables in `OUT_DIR`, embedding files with the same bytes once, and only listed names are served. It also derives a build ID for the page from its HTML and file names. Missing files, a missing `.gz`, or HTML that loads an unlisted file stop the build with `Run "pnpm --dir web build" first.`, which is why the web build comes before `cargo build`. `web/dist/` is not committed.
- Each HTML page carries its build ID in `<meta name="agboard-build">`, and the SSE `ready` event names the server's current one. When they differ, the page reloads once, waiting until no edit dialog, unsent answer, or other operation is open (`useBuildReload`). A tab that already reloaded for a build does not reload for it again, and a page without a build ID (the Vite dev server) never reloads.
- Pure display functions (dates, sorting, counts) live in `web/src/features/*/model/` or `web/src/shared/lib/` with Vitest tests; components are tested with Testing Library.
- shadcn Radix components (Dialog, Button, Badge, Input, Textarea, Label, RadioGroup, DropdownMenu) and the phone screen's bottom sheet (`drawer.tsx`, built on the Radix Dialog) live in `web/src/shared/ui/`, with `cn` in `web/src/shared/lib/classnames/utils.ts` and the `@/* → ./src/*` alias. Dialog focus is left to the library; features handle blocking close while saving, submission, and input retention. UI styles are in `shared/styles/ui.css`; theme and product styles in `shared/styles/theme.css`, `tokens.css`, and `app.css`.
- No external CDN or fonts are loaded; fonts come from the `--font-sans` and `--font-mono` stacks.
- Body limits, format validation, draft rules, and errors live once in `domain` and `file_store`, shared by the CLI and the server.

**Rendering user text.** Text is rendered through React's normal escaping, never `dangerouslySetInnerHTML`. Markdown becomes React elements (react-markdown, remark-gfm, without `rehype-raw`) with raw HTML shown as text. Only `http` and `https` links are active, opening in a new tab. Owned images (`assets/<id>.<ext>`, `attachment:<id>`) resolve to the image API; external images load only from `http`/`https` with `referrerpolicy="no-referrer"` and fall back to "No image". Mermaid renders with `securityLevel: 'strict'`, and only the SVG it generates is inserted.

**The bottom sheet's drag.** Dragging the sheet's top handle does not touch React state. `useDrawerDrag` (`web/src/shared/ui/use-drawer-drag.ts`) keeps the pointer and the pull in refs, measures the sheet once when a drag starts, and writes the pull at most once per animation frame to the `--drawer-drag-y` property of the sheet and the `--drawer-swipe-progress` property of the backdrop. The stylesheet turns them into `translate` and `opacity`. A drag longer than a quarter of the sheet's height, or a flick faster than 0.5 px/ms over at least 24 px, closes the sheet; a shorter or cancelled drag returns it by a transition that exists only while the sheet is open, so a transition and a keyframe never drive `translate` together. A sheet that is dismissed keeps its pull for the exit keyframe, and a sheet that opens drops any earlier pull before it is painted. See [remote access](../../guide/watch/remote-access.md) for the behavior.

**The editor.** `RichMarkdownEditor` (Milkdown Crepe) keeps the `MarkdownEditor` contract: `value`, `onChange`, `onCursorChange`, `disabled`, and a ref with `goTo`, `focus`, and `insert`. It loads lazily and shows `MarkdownView` meanwhile. Only CodeMirror, ListItem, ImageBlock, Cursor, Placeholder, LinkTooltip, Toolbar, and Table are enabled, without Crepe's theme. The initial value is passed once on mount; `onChange` fires only for user edits, and an untouched document is saved as the original string so unchanged Markdown is not reformatted. Uploads become pending attachments referenced as `assets/<id>.<ext>`. Mermaid previews and the viewer share `renderMermaid`. Inside `web/src/shared/rich-editor/`, `RichMarkdownEditor.impl.tsx` only keys a session by the external value; `useRichEditorSession.ts` owns the session (original, edited, pending commands, heading offsets, cleanup), `createEditor.ts` the feature set, `editorCommands.ts` the `goTo`, `focus`, `insert`, and `markdown` handle, and `MermaidPreviews.ts` the diagram previews, which take the page's translation for the error line. The handle's commands run from the first animation frame after Crepe finishes creating the editor, and commands sent earlier wait for it: in that frame Crepe's list items put back the selection they saw when they were drawn, which would otherwise undo a `goTo` or `insert`.

**Themes.** `web/src/shared/theme/index.ts` owns theme types, the list, validation, and DOM attributes. A theme is a mode (light or dark) and one of 12 accents. It is applied before React renders by syncing `data-mode`, `data-accent`, the `dark` class, and `color-scheme`. The saved value is the PC's `preferences.json`, read and written by `web/src/shared/preferences/index.ts` through `GET` and `PUT /api/preferences` (see [Shared files](../reference/files.md#display-preferences)). The browser keeps a copy in `localStorage` (`agboard.theme` and `agboard.locale`) only for the first paint. Theme changes never reach the task history.

The epic list reads the epics and their progress from the project's Summary. The server computes the progress from the same snapshot as the epics, so the list never mixes two reads. The phone screen of remote access has no epic list; at 768px or wider, remote access shows the PC board, epic list included. The list shares its frame with the archive through `ListPane`, and each state (loading, load failure, refresh failure, empty) comes from the project resource, so a failed refresh keeps the last good rows.

Task details (including the archive and monitor) and epic details share `DetailHeader` in `web/src/features/tasks/detail/DetailHeader.tsx`. It places the identity, action toolbar, and close control in one common layout so the close control keeps the same spacing. Each host supplies its own actions.

### Where the web code lives

`web/src/` has four layers, from top to bottom:

| Layer | Holds |
| --- | --- |
| `app/` | The entry (`entry/board.tsx`), the board `App`, the project session, the aggregate `api.ts`, the lazy dialog connection, and the sample-data mode. |
| `pages/` | One folder per screen: `board/`, `archive/`, `epics/`, and `monitor/` (the phone screen's parts). |
| `features/` | `tasks/`, `epics/`, `projects/`, `settings/`, `docs/` (the project docs dialog), and `monitor-connections/` (the PC dialog for the remote connection): the views, hooks, calculations, and requests of one subject. |
| `shared/` | `ui/` primitives and generic shells, `markdown/`, `rich-editor/`, `api/` (HTTP helpers and the server's wire types), `lib/`, `styles/`, `theme/`, and `i18n/`. |

A file may import its own feature or page and the layers below it. `shared/` imports nothing above itself, one feature never imports another, and one page never imports another. When a part needs something from a neighbouring feature, the page or `app/` composes it: `TaskCard` takes `renderEpic`, `EditDialog` takes `renderEpicChip`, `EpicDialog` takes `renderTask`, and `Header` takes `projectSwitcher` and `settings`. The settings slot of the board (`app/BoardSettings.tsx`) is one of these compositions: it puts the tutorial and remote connection rows in the settings dialog and owns the connection dialog next to it, so the settings dialog closes before the connection dialog opens. Both rows are thin wrappers (`TutorialEntryRow`, `ConnectionEntryRow`) around the shared `SettingsEntryRow` in `shared/ui`, which draws the icon tile, the text and the button. The monitor receives `useBuildReload` from its entry in the same way.

`pnpm --dir web check` runs `web/scripts/check-boundaries.mjs` after Biome. It follows static imports, `import type`, re-exports, and `import()`, and fails on an import that breaks these rules, one it cannot resolve, or an import cycle. Do not silence it with an allowlist; move the shared piece down or compose it in the page. Do not re-export a whole feature from one file, because a heavy module such as the editor or the Markdown renderer would then reach the first script. Lazy imports name the implementation file.

Keep a UI part's Stories, focused tests, dedicated CSS, and coverage ledger beside its source. The ledger connects each exported part to its Story IDs and visible states. A page-level Story documents the composed screen; a part-level Story documents the states and interactions owned by that part. See [Storybook](../getting-started/setup.md#storybook) for the commands and the current coverage limits.

## Reading and updating data

The board and the phone screen read a project in two steps. The Summary (`GET .../summary`) holds what every card and list row shows. The server builds it from the index, so reading it reads no file. A Detail (`GET .../tasks/{id}/detail` or `.../epics/{epicId}/detail`) holds a body, its acceptance text, and its history. The UI reads a Detail only when someone opens that card or epic. The wire shapes are in [Web API](../reference/web-api.md#summary-and-detail).

The data layer in `web/src/shared/data/` keeps these reads in one place, in three parts:

- `api/`: the contract types and the parser for the Detail NDJSON stream. A stream is accepted only after its `complete` line.
- `core/`: code that does not depend on React. `ResourceStore` holds the Summaries and the Details, one entry per section. `RefreshScheduler` collects the notifications of a 150 ms window, joins requests for one resource into one fetch, runs at most two background fetches at once, and fetches only the sections a notification named. `ChangeInvalidator` turns a `changed` event into the smallest invalidation that is still safe. `EventConnection` opens and closes the event stream.
- `react/`: the hooks that the screens use, such as `useSummary`, `useTaskDetail`, `useEpicDetail`, and `usePresentationHold`.

The cache has fixed limits and no time-based expiry. It keeps the Summary of the last four projects, one for each project. It keeps up to 60 task Details within 8 MiB and up to 20 epic Details within 4 MiB, and drops the least recently used entries above those limits. The limits are in `web/src/shared/data/core/limits.ts`.

**Holding updates.** Automatic updates do not change the screen while a dialog (an editor, a preview, or any other modal) is open. The data core holds them while the dialog is open, and it applies them together 3 seconds after the last one closes. The detail, archive, and epic panels beside the PC board do not hold updates: the board and the open panel follow the stream, and the panel's open sections are read again when a change names them. The event stream stays open during the hold, but nothing is fetched. Saving and answering skip the hold and apply at once. So does a `changed` event with the `request` facet (the question a task waits on changed): its Summary and the sections it names are fetched at once, while other held updates keep waiting. The PC board has no manual refresh; a page reload reads everything again.

**Messages.** The Summary's `messages` lists the open messages of the project (see [Web API](../reference/web-api.md#summary-and-detail)). The **Messages** band (`MessageBand`) counts them, and the list (`MessageCenter` with `MessagesSurface`, in `web/src/features/tasks/messages/`) shows them in two tabs, one for what the AI asks you and one for your own requests. The list is a modal on the PC and a bottom sheet on the phone screen. A list that is only open holds no updates: a message that is answered, accepted, or withdrawn is replaced or closed in it as it happens. A build reload waits while the list or the **Ask AI** editor is open on the phone screen, since a reload would lose an answer being written. For the screens, see [Decisions](../../guide/delegate/decisions.md#the-list-of-messages).

**Rendering Markdown.** The server splits a body into top-level Markdown blocks. It joins small neighbours up to about 2,000 characters, and it never cuts a list, a table, a code fence, or a quote. A Mermaid fence is a block of its own. The UI renders the blocks in order. A document with 40 blocks or more, or with 5,000 characters or more, is virtualized: only the blocks near the viewport are mounted. The virtual list is a separate chunk that loads when such a document is shown. A decision's question (`DecisionQuestion`) and a history reason (`HistoryTimeline`) go through the same block renderer as the body.

**Detail tabs on the board.** The detail panel reads only what its active tab shows. The Description and Conditions tabs read the `document` section, the History tab reads `history`, and the Epic tab reads the epic's document the first time it is opened. The count on the History tab appears after the history has been read.

## Behavior on failure in the UI

**Saving and answering**

- Create, move, and answer are never applied optimistically. The UI waits for success and keeps the input and selection for a retry on failure.
- The full text of a question or request is read when its row is opened, with `GET .../messages/{id}` (`web/src/features/tasks/messages/api.ts`). The Summary's `messages` carries only the first line. A task's `openQuestionIds` lists the questions it waits on, and its **Answer the question** button opens the list at the first of them (`useMessagesController`). For the screens, see [Decisions](../../guide/delegate/decisions.md).
- An answer is not held on the page. **Send answer** in `MessagesSurface` sends the one question through `POST .../messages/answers` with `{answers:[{questionId, choiceId?, text?}]}` and then returns to the list, and the screen reads the project again at once. Nothing is kept across a reload. A question with choices needs a choice, and the text only adds to it (`canSendAnswer` in `web/src/features/tasks/messages/model/messages.ts`).
- A 409 (`question_answered`, `question_withdrawn`, or `message_closed`) saves nothing, and the surface says that the question was answered elsewhere or withdrawn. A message that leaves the list while its row is open takes the person back to the list. A failed send keeps the choice and the text for a retry. A retried send is not deduplicated; after success it fails with `question_answered` because the first answer is final.
- A person's request is written in the **Ask AI** composer (`web/src/features/messages/ask/`), a modal on the PC and a sheet on the phone screen, laid out like a chat input (a plain text field, a toolbar with **Image** and **Send request**, and the thumbnails above it; see [Ask AI](../../guide/watch/editing.md#ask-ai)). On the sheet, `watchKeyboardInset` (`web/src/shared/viewport/keyboardInset.ts`) keeps `--keyboard-inset` and `--visual-vh` from the visual viewport, so the sheet is lifted above the on-screen keyboard that iOS Safari draws over the unresized page. While the inset exceeds 80 px it also sets `data-keyboard-open` on the root, and the sheet then fills the visible area above the keyboard. `sendRequest.ts` builds one multipart body with the `text` and one `images` part per picture, and posts it to `POST .../messages/requests` (up to 20,000 characters). A request that no agent has accepted yet can be withdrawn from its row in the list.
- There is no plan review and no start route in the web UI. AI drafts are ordinary cards in Todo with a draft badge, and the agent starts them itself with the CLI after the questions about them are answered (see [Drafts](./tasks-and-states.md#drafts)). To change a plan, a person edits the drafts or sends a request.
- `DecisionQuestion` and `DecisionAnswerFields` (`web/src/features/tasks/answer/`) draw the question and the answer fields for the list. Moves and other operations stay available while an answer is being sent.

**Drafts and editing**

- Previews for a task and an epic (`TaskPreviewDialog` in `web/src/app/dialogs/TaskPreviewDialog.tsx`, and the epic preview) enter the draft at the first change. Before the draft starts, they compare the content they opened with the content the server returns; a difference stops the save and keeps the text. The comparison ignores `updatedAt`, which agent state changes also move. `invalid_state_for_draft` is shown as a running task.
- Other web edits do not compare content on save (last write wins). An agent overwriting a task with content read before it became a draft, or edits in several tabs, cannot be prevented.
- While a preview has no change, it follows the card. `useStreamSubscriptions` (`web/src/app/model/useStreamSubscriptions.ts`) passes every change note of the active project to the preview, which reads the card or epic again and compares. The preview turns read-only while the card runs or is archived, and back when it stops running. The follow does not wait for the board's deferred updates.
- If a person forgets to finalize a draft, the agent cannot move the task; `draft` shows this in the UI and JSON.
- External images that fail to load show "No image" without blocking anything else.

**Switching projects**

- Switching clears the previous project's tasks and selection. If the board fails to load, the URL target is kept for a retry. If the project list fails, the UI shows a global error and retry instead of guessing from a stale list.
- Late board, save, and re-fetch responses apply only when they match the current target ID and request number. Switching projects waits until every save in progress finishes.
- Back and forward during input or a save hold the latest URL target and apply it after completion or cancellation.
- After a rename, forms and URLs already started keep the same ID. If the selected project is deleted, the UI says so and lets the user choose another; after the last one is deleted, it offers to create one.

**Archive**

- The browser keeps the confirmation open until success and allows a retry after a network failure. While saving, it blocks double submission, closing, and switching, and drops late responses whose start ID or request number differ.
- A 404 on delete re-fetches and shows that the task is already gone; a network failure is never treated as a successful delete. Empty, loading, list-failure-with-retry, and disconnected states apply to the archive view too.

**Preferences**

- The language and color theme are saved on the PC, in one file, and every browser on the PC and every phone use that value. A missing, invalid, or unreadable file falls back to the defaults (English and light blue); the browser or OS language and color scheme are never used.
- On startup the page paints from its browser copy, then loads `GET /api/preferences`. If the PC value differs, the page changes to it. The PC value is the one that counts; the browser copy only avoids a flash of the wrong theme.
- A `preferences` event applies a change to every open page at once, without a reload. A page ignores an older response or event when it already shows a newer revision.
- A failed save (`invalid_preferences`, `preferences_unavailable`, or no connection) still applies the choice to the current page, shows a save error in the settings dialog, and leaves the PC value unchanged. A missing Japanese translation key shows the English string. Preference failures never change board data.
- The detail panel width is not a saved preference. It stays per browser under its own key (`agboard.detailWidth`), and a missing or invalid width falls back to the default.

### The docs dialog

`DocsDialogContainer` (`web/src/features/docs/ui/`) owns the dialog's data; the screen and its states are described in the [user guide](../../guide/watch/docs.md).

- The dialog only shows files. `useDocsTree` fetches the tree when the dialog opens. `useDocument` fetches a file each time it is chosen and keeps nothing between choices; each load gets an ID that keys the viewer. A Markdown file is shown by `RichMarkdownEditor` with `disabled`, an `.mdx` file by `MdxFrame` (the sandbox page), and an image by `FileViewer`. The front matter is split off with `splitFrontmatter` (`shared/markdown/frontmatter.ts`) and shown above the body.
- **Open in editor** posts `docs/open?path=`, and the server opens the file in the computer's app for it.
- The dialog follows the files through `useDocsFollow`. The app passes it `subscribeDocs`, which turns the stream's `docs` notes for the project, and every reopened stream (`sync`), into calls. Each call reads the tree again quietly (`refresh`, without the loading state). If the open file is no longer in the tree, it is `deleted`; otherwise `useDocument.refresh` reads it again and replaces it only when its `revision` differs, which is `updated`. The notice, with its time, sits at the left of the footer (the shell's `footerStart`) and belongs to that file only. The docs never wait behind the modal hold, because they are not board data.
- Links never navigate the board. `DocumentPane` catches the clicks on links in a Markdown body, and the sandbox page sends `{type: 'link', href}` for a link in an `.mdx` body. `resolveDocsLink` (`features/docs/model/docsLink.ts`) reads the `href` against the file's folder and the tree: a listed file is chosen (a folder link chooses its `README.md`), `http` and `https` open in a new tab with `noopener,noreferrer`, and a relative path to no listed file shows **The linked file is not in the docs.** in the footer. Anchors in the page and other schemes do nothing. `DocsFileTree` opens the folders above a file chosen this way and scrolls it into view.
- Relative images go through `resolveRelativeImage` (`shared/markdown/resolveRelativeImage.ts`), which resolves `src` against the file's folder, and then to the image route. Owned attachments and unsafe schemes never reach it.
- The header shows **Docs** on the board only. The board composes the container in `app/`, keyed by project, so a project switch starts it over. The dialog is loaded on first use.

## Reading across projects

`ls --all-projects` reads every project in turn. Each project is returned from before or after any concurrent save, with no consistency across projects. It never creates the data area, notifies, or changes files. Without a data area it returns empty `projects`; if any `project.json` is invalid it returns only the error, never partial output.

## The first-run guide

The guide runs entirely in the browser. The server keeps one fact about it: whether the data area has seen it. `GET /api/onboarding` answers `unseen`, `completed`, or `skipped`, and `POST /api/onboarding/seen` records `completed` or `skipped` ([web API](../reference/web-api.md)). Nothing else about the guide is stored, locked, or claimed, so any number of tabs can show it, and no tab can block another.

The guide's view parts are in `web/src/features/onboarding/ui`. They take only props and do not import the board. The controller in `web/src/app/onboarding` (`useGuide`) holds the step (`samples`, `first-running`, `first-done`, `question`, `second-running`, `second-done`) and the 1.8 second hold on a running card, and returns the two sample cards of that step. The cards come from `guideSamples.ts`: plain `TaskSummary` values with negative IDs that no real task can have, in the language of the screen when the guide starts. They are never written to the board, so they appear in no count, list, or request. `GuideLayer` joins the views to the board: it measures the lane the guide points at and draws copies of the sample cards inside the spotlight with the product's own `TaskCard`, while the real cards stay dimmed beneath. `App` mounts the layer above the width switch and as a separately loaded chunk, so the guide's code stays out of the board's first load and one controller serves both layouts: a change of width keeps the step the guide is on.

The guide is offered once per project load. When the board is ready (no other operation, answer, Epics view, or archive view is open) and `GET /api/onboarding` says `unseen`, the controller shows the welcome. **Skip** and **End guide** hide the guide and, for an offered guide, record `skipped`; **Finish and get started** records `completed`. A guide shown from the settings records nothing when it is ended early. The settings dialog's **Tutorial** row calls `requestTutorial()`, and `useTutorialReplay` keeps that request until the board can show the guide, then shows the welcome on the same screen without any request, whatever the server says and whatever other tabs do. A failed read shows nothing, and a failed record is ignored: the guide hides anyway and is offered again next time. The requests send `authHeaders()`, so a session through the ngrok entrance behaves the same way.

The question is answered locally. The second card shows Pending with **Answer the question**, and the button opens `SampleAnswer` (`web/src/app/onboarding/SampleAnswer.tsx`): the product's own list of messages (`MessagesSurface`) with one local question that the guide fills with its own text and choices. Choosing an option and sending only tells the controller to resume the second card. Nothing is posted, and the answer is not kept.

The spotlight frame is as tall as the cards inside it, up to a cap that keeps its bottom 24 px above the guide panel. Cards taller than the cap scroll inside the frame.

On the phone screen (`App` passes `phone`, with a `PhoneGuideLink`) the layer frames the top of the step's lane on the phone's lane view instead of a lane of the PC board. `usePhoneLaneRect` measures the lane's `.monitor-lane__scroll` area, keeps it scrolled to the top, and follows it while the lane slides onto the screen; the sample cards, drawn with the phone's own `MonitorTask`, sit inside the frame. The link (`web/src/features/onboarding/model/phoneGuideLink.ts`) carries one thing: the guide asks the phone screen to show the lane its step is about, so the lane and its tab are on screen. While the sample answer sheet is open, the explanation becomes a strip at the top and the stage frames nothing. The explanation and dialogs follow the width in CSS (`max-width: 767px`). Buttons in the guide are full width, and two in a row split the row evenly, on both layouts.
