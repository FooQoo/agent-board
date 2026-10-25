# Server and web UI

`agboard serve` serves the board to browsers: a JSON API, live updates, and the React app embedded in the binary. This page covers how requests are handled, how the UI is built, and how the UI behaves when something fails. The endpoints are in [Web API](../reference/web-api.md).

## Starting and stopping serve

- `serve` listens only on `127.0.0.1` and works with zero projects; it may create `workspace.json` in an empty data area.
- `lifecycle.lock` (a standard `try_lock`) is held from start to exit so that only one server runs per data area. The file existing does not mean a server is running; the lock is released when the process exits.
- At startup, if `serve.json` exists and `GET /api/health` on its port returns the same `pid`, `serve` exits with `already_serving`. Otherwise the file is stale and is overwritten.
- `serve` writes `serve.json` (`pid`, `port`, `started_at`) after it starts listening. On SIGINT or SIGTERM it removes `serve.json` only if the file holds its own pid.

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
- `pnpm --dir web build` emits `index.html`, the entry script and stylesheet `assets/app-[hash].js` and `assets/app-[hash].css`, the editor and Mermaid as dynamic chunks `assets/chunk-[name]-[hash].js`, and a separate `monitor/` build with its own manifest. The board build also writes `chunk-graph.json`, its chunks with their imports, `web/src/` modules, and packages. Its last step writes a `.gz` beside every script and stylesheet.
- The first script holds only what the first screen needs. The card, epic, bulk-archive and settings dialogs, the Markdown renderer of the detail panel, and the monitor's detail drawer are split out with `preloadable` (`web/src/shared/lib/lazy/preloadable.ts`) and fetched right after the first screen is shown; a description shows its plain text until the renderer arrives. The editor's outline reads `##` headings with the viewer's Markdown parser, so CodeMirror loads only with the editor.
- `web/test/monitor/build-contract.test.ts` keeps a budget for each page's first load (the entry and the chunks it imports statically) and requires every script over 500 kB to load on use only. Vite's `chunkSizeWarningLimit` is raised to 1500 kB for those on-use chunks: Mermaid's ELK layout, its grammar parser, and the rich editor.
- Rust embeds both logos, the HTML templates, and the `.gz` files. `build.rs` lists the scripts and stylesheets of the board and the monitor in tables in `OUT_DIR`, embedding a file that both contain once, and only listed names are served. It also derives a build ID for each page from its HTML and file names. Missing files, a missing `.gz`, or HTML that loads an unlisted file stop the build with `Run "pnpm --dir web build" first.`, which is why the web build comes before `cargo build`. `web/dist/` is not committed.
- Each HTML page carries its build ID in `<meta name="agboard-build">`, and the SSE `ready` event names the server's current one. When they differ, the page reloads once, waiting until no edit dialog, unsent answer, or other operation is open (`useBuildReload`). A tab that already reloaded for a build does not reload for it again, and a page without a build ID (the Vite dev server) never reloads.
- Pure display functions (dates, sorting, counts) live in `web/src/features/*/model/` or `web/src/shared/lib/` with Vitest tests; components are tested with Testing Library.
- shadcn Radix components (Dialog, Button, Badge, Input, Textarea, Label, RadioGroup, DropdownMenu) and the monitor's bottom sheet (`drawer.tsx`, built on the Radix Dialog) live in `web/src/shared/ui/`, with `cn` in `web/src/shared/lib/classnames/utils.ts` and the `@/* → ./src/*` alias. Dialog focus is left to the library; features handle blocking close while saving, submission, and input retention. UI styles are in `shared/styles/ui.css`; theme and product styles in `shared/styles/theme.css`, `tokens.css`, and `app.css`.
- No external CDN or fonts are loaded; fonts come from the `--font-sans` and `--font-mono` stacks.
- Body limits, format validation, draft rules, and errors live once in `domain` and `file_store`, shared by the CLI and the server.

**Rendering user text.** Text is rendered through React's normal escaping, never `dangerouslySetInnerHTML`. Markdown becomes React elements (react-markdown, remark-gfm, without `rehype-raw`) with raw HTML shown as text. Only `http` and `https` links are active, opening in a new tab. Owned images (`assets/<id>.<ext>`, `attachment:<id>`) resolve to the image API; external images load only from `http`/`https` with `referrerpolicy="no-referrer"` and fall back to "No image". Mermaid renders with `securityLevel: 'strict'`, and only the SVG it generates is inserted.

**The bottom sheet's drag.** Dragging the sheet's top handle does not touch React state. `useDrawerDrag` (`web/src/shared/ui/use-drawer-drag.ts`) keeps the pointer and the pull in refs, measures the sheet once when a drag starts, and writes the pull at most once per animation frame to the `--drawer-drag-y` property of the sheet and the `--drawer-swipe-progress` property of the backdrop. The stylesheet turns them into `translate` and `opacity`. A drag longer than a quarter of the sheet's height, or a flick faster than 0.5 px/ms over at least 24 px, closes the sheet; a shorter or cancelled drag returns it by a transition that exists only while the sheet is open, so a transition and a keyframe never drive `translate` together. A sheet that is dismissed keeps its pull for the exit keyframe, and a sheet that opens drops any earlier pull before it is painted. See [the mobile monitor](../../guide/operations/mobile-monitor.md) for the behavior.

**The editor.** `RichMarkdownEditor` (Milkdown Crepe) keeps the `MarkdownEditor` contract: `value`, `onChange`, `onCursorChange`, `disabled`, and a ref with `goTo`, `focus`, and `insert`. It loads lazily and shows `MarkdownView` meanwhile. Only CodeMirror, ListItem, ImageBlock, Cursor, Placeholder, LinkTooltip, Toolbar, and Table are enabled, without Crepe's theme. The initial value is passed once on mount; `onChange` fires only for user edits, and an untouched document is saved as the original string so unchanged Markdown is not reformatted. Uploads become pending attachments referenced as `assets/<id>.<ext>`. Mermaid previews and the viewer share `renderMermaid`. Inside `web/src/shared/rich-editor/`, `RichMarkdownEditor.impl.tsx` only keys a session by the external value; `useRichEditorSession.ts` owns the session (original, edited, pending commands, heading offsets, cleanup), `createEditor.ts` the feature set, `editorCommands.ts` the `goTo`, `focus`, `insert`, and `markdown` handle, and `MermaidPreviews.ts` the diagram previews, which take the page's translation for the error line.

**Themes.** `web/src/shared/theme/index.ts` owns theme types, the list, validation, and DOM attributes. A theme is a mode (light or dark) and one of 12 accents. It is applied before React renders by syncing `data-mode`, `data-accent`, the `dark` class, and `color-scheme`. The saved value is the PC's `preferences.json`, read and written by `web/src/shared/preferences/index.ts` through `GET` and `PUT /api/preferences` (see [Shared files](../reference/files.md#display-preferences)). The browser keeps a copy in `localStorage` (`agboard.theme` and `agboard.locale`) only for the first paint. Theme changes never reach the task history.

The epic list reads the epics and their progress from the project's Summary. The server computes the progress from the same snapshot as the epics, so the list never mixes two reads. The mobile monitor has no epic list screen. The list shares its frame with the archive through `ListPane`, and each state (loading, load failure, refresh failure, empty) comes from the project resource, so a failed refresh keeps the last good rows.

Task details (including the archive and monitor) and epic details share `DetailHeader` in `web/src/features/tasks/detail/DetailHeader.tsx`. It places the identity, action toolbar, and close control in one common layout so the close control keeps the same spacing. Each host supplies its own actions.

### Where the web code lives

`web/src/` has four layers, from top to bottom:

| Layer | Holds |
| --- | --- |
| `app/` | The two entries (`entry/board.tsx`, `entry/monitor.tsx`), the board `App`, the project session, the aggregate `api.ts`, the lazy dialog connection, and the sample-data mode. |
| `pages/` | One folder per screen: `board/`, `archive/`, `epics/`, and `monitor/`. |
| `features/` | `tasks/`, `epics/`, `projects/`, `settings/`, `docs/` (the project docs dialog), and `monitor-connections/` (the PC dialog for the mobile connection): the views, hooks, calculations, and requests of one subject. |
| `shared/` | `ui/` primitives and generic shells, `markdown/`, `rich-editor/`, `api/` (HTTP helpers and the server's wire types), `lib/`, `styles/`, `theme/`, and `i18n/`. |

A file may import its own feature or page and the layers below it. `shared/` imports nothing above itself, one feature never imports another, and one page never imports another. When a part needs something from a neighbouring feature, the page or `app/` composes it: `TaskCard` takes `renderEpic`, `RequestDialog` takes `renderEpic`, `EditDialog` takes `renderEpicChip`, `EpicDialog` takes `renderTask`, and `Header` takes `projectSwitcher` and `settings`. The settings slot of the board (`app/BoardSettings.tsx`) is one of these compositions: it puts the tutorial and mobile connection rows in the settings dialog and owns the connection dialog next to it, so the settings dialog closes before the connection dialog opens. Both rows are thin wrappers (`TutorialEntryRow`, `ConnectionEntryRow`) around the shared `SettingsEntryRow` in `shared/ui`, which draws the icon tile, the text and the button. The monitor receives `useBuildReload` from its entry in the same way.

`pnpm --dir web check` runs `web/scripts/check-boundaries.mjs` after Biome. It follows static imports, `import type`, re-exports, and `import()`, and fails on an import that breaks these rules, one it cannot resolve, or an import cycle. Do not silence it with an allowlist; move the shared piece down or compose it in the page. Do not re-export a whole feature from one file, because a heavy module such as the editor or the Markdown renderer would then reach the first script. Lazy imports name the implementation file.

Keep a UI part's Stories, focused tests, dedicated CSS, and coverage ledger beside its source. The ledger connects each exported part to its Story IDs and visible states. A page-level Story documents the composed screen; a part-level Story documents the states and interactions owned by that part. See [Storybook](../getting-started/setup.md#storybook) for the commands and the current coverage limits.

## Reading and updating data

The board and the monitor read a project in two steps. The Summary (`GET .../summary`) holds what every card and list row shows. The server builds it from the index, so reading it reads no file. A Detail (`GET .../tasks/{id}/detail` or `.../epics/{epicId}/detail`) holds a body, its acceptance text, and its history. The UI reads a Detail only when someone opens that card or epic. The mobile monitor uses the same contract under `/monitor/api/projects/{projectId}/`. The wire shapes are in [Web API](../reference/web-api.md#summary-and-detail).

The data layer in `web/src/shared/data/` keeps these reads in one place, in three parts:

- `api/`: the contract types and the parser for the Detail NDJSON stream. A stream is accepted only after its `complete` line.
- `core/`: code that does not depend on React. `ResourceStore` holds the Summaries and the Details, one entry per section. `RefreshScheduler` collects the notifications of a 150 ms window, joins requests for one resource into one fetch, runs at most two background fetches at once, and fetches only the sections a notification named. `ChangeInvalidator` turns a `changed` event into the smallest invalidation that is still safe. `EventConnection` opens and closes the event stream.
- `react/`: the hooks that the screens use, such as `useSummary`, `useTaskDetail`, `useEpicDetail`, and `usePresentationHold`.

The cache has fixed limits and no time-based expiry. It keeps the Summary of the last four projects, one for each project. It keeps up to 60 task Details within 8 MiB and up to 20 epic Details within 4 MiB, and drops the least recently used entries above those limits. The limits are in `web/src/shared/data/core/limits.ts`.

**Holding updates.** Automatic updates do not change the screen while a drawer or a dialog is open. The data core holds them while the panel is open, and it applies them together 3 seconds after the last panel closes. The event stream stays open during the hold, but nothing is fetched. Saving and answering skip the hold and apply at once. The PC board has no manual refresh; a page reload reads everything again.

**Rendering Markdown.** The server splits a body into top-level Markdown blocks. It joins small neighbours up to about 2,000 characters, and it never cuts a list, a table, a code fence, or a quote. A Mermaid fence is a block of its own. The UI renders the blocks in order. A document with 40 blocks or more, or with 5,000 characters or more, is virtualized: only the blocks near the viewport are mounted. The virtual list is a separate chunk that loads when such a document is shown.

**Detail tabs on the board.** The detail panel reads only what its active tab shows. The Description and Conditions tabs read the `document` section, the History tab reads `history`, and the Epic tab reads the epic's document the first time it is opened. The count on the History tab appears after the history has been read.

## Behavior on failure in the UI

**Saving and answering**

- Create, move, and answer are never applied optimistically. The UI waits for success and keeps the input and selection for a retry on failure.
- Answer forms on desktop and mobile submit only the current Pending request of a Todo/Doing task, never twice, and never again after success even if an older snapshot is shown. After a lost response, the UI re-reads the snapshot and checks the request ID and state before retrying.
- A retried answer is not deduplicated; after success it fails with `request_changed` because the request is already cleared. Image uploads are not deduplicated either, so a retry after a lost response can add the same image twice.
- Desktop answer input is kept per project, task, and request. A Todo/Doing move that withdraws the request keeps the input but stops the stale answer and asks the user to check. A move to Done distasks the input, and late responses never bring it back. Moves and other operations stay available while an answer is being sent.
- The shared `DecisionRequestForm` gives desktop and mobile the same input, validation, sending, and failure states.

**Drafts and editing**

- Web edits do not compare content on save (last write wins). An agent overwriting a task with content read before it became a draft, or edits in several tabs, cannot be prevented.
- If a person forgets to finalize a draft, the agent cannot move the task; `isDraft` shows this in the UI and JSON.
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

- The language and color theme are saved on the PC, in one file, and every browser on the PC and the mobile monitor use that value. A missing, invalid, or unreadable file falls back to the defaults (English and light blue); the browser or OS language and color scheme are never used.
- On startup the page paints from its browser copy, then loads `GET /api/preferences`. If the PC value differs, the page changes to it. The PC value is the one that counts; the browser copy only avoids a flash of the wrong theme.
- A `preferences` event applies a change to every open page at once, without a reload. A page ignores an older response or event when it already shows a newer revision.
- A failed save (`invalid_preferences`, `preferences_unavailable`, or no connection) still applies the choice to the current page, shows a save error in the settings dialog, and leaves the PC value unchanged. A missing Japanese translation key shows the English string. Preference failures never change board data.
- The detail panel width is not a saved preference. It stays per browser under its own key (`agboard.detailWidth`), and a missing or invalid width falls back to the default.

### The docs dialog

`DocsDialogContainer` (`web/src/features/docs/ui/`) owns the dialog's data; the screen and its states are described in the [user guide](../../guide/use/docs.md).

- The dialog only shows files. `useDocsTree` fetches the tree when the dialog opens. `useDocument` fetches a file each time it is chosen and keeps nothing between choices; each load gets an ID that keys the viewer. A Markdown file is shown by `RichMarkdownEditor` with `disabled`, an `.mdx` file by `MdxFrame` (the sandbox page), and an image by `FileViewer`. The front matter is split off with `splitFrontmatter` (`shared/markdown/frontmatter.ts`) and shown above the body.
- **Open in editor** posts `docs/open?path=`, and the server opens the file in the computer's app for it.
- The dialog follows the files through `useDocsFollow`. The app passes it `subscribeDocs`, which turns the stream's `docs` notes for the project, and every reopened stream (`sync`), into calls. Each call reads the tree again quietly (`refresh`, without the loading state). If the open file is no longer in the tree, it is `deleted`; otherwise `useDocument.refresh` reads it again and replaces it only when its `revision` differs, which is `updated`. The notice, with its time, sits at the right of the footer and belongs to that file only. The docs never wait behind the drawer and modal hold, because they are not board data.
- Relative images go through `resolveRelativeImage` (`shared/markdown/resolveRelativeImage.ts`), which resolves `src` against the file's folder, and then to the image route. Owned attachments and unsafe schemes never reach it.
- The header shows **Docs** on the board only. The board composes the container in `app/`, keyed by project, so a project switch starts it over. The dialog is loaded on first use.

## Reading across projects

`ls --all-projects` reads every project in turn. Each project is returned from before or after any concurrent save, with no consistency across projects. It never creates the data area, notifies, or changes files. Without a data area it returns empty `projects`; if any `project.json` is invalid it returns only the error, never partial output.

## The first-run guide

The guide's view parts are in `web/src/features/onboarding/ui`. They take only props and do not import the board. The controller in `web/src/app/onboarding` (`useGuide`) calls the guide routes, runs the scripted steps, and renews the lease every 10 seconds. `GuideLayer` joins the views to the board: it measures the lane the guide points at, and renders the real task card and its answer form inside the spotlight. `BoardWorkspace` mounts the layer as a separately loaded chunk, so the guide's code stays out of the board's first load. The guide is offered only on the board view, while no other operation, answer, Epics view, or archive view is open. The settings dialog's **Tutorial** row asks the board to show a finished or skipped guide again: `useTutorialReplay` keeps that request until the board can show the guide, then calls `POST /api/onboarding/replay`. The guide's routes are registered only on the PC board router. The monitor has its own `/monitor/api` routes, and none of them serve the guide.

The spotlight frame is as tall as the cards inside it, up to a cap that keeps its bottom 24 px above the guide panel. Cards taller than the cap scroll inside the frame. The controller reads the guide once for each project the board shows, and sends every command to the project on screen. If a tab was closed or reloaded in the middle of a run, the file stays `active` with an expired lease; the first read then asks the server to take the run back, and the guide is offered again as an interrupted one. A failed request with an HTTP status of 500 or more shows the translated network message rather than the server's English text.