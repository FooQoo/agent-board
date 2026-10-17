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

JSON and HTML responses are `no-store`. HTML responses carry `Referrer-Policy: no-referrer` and a `Content-Security-Policy`: scripts and connections from self only; styles from self and `'unsafe-inline'` (the editor injects `<style>` at runtime); images from self, `data:`, `http`, and `https`.

## How the web UI is built

- `web/` is a Vite, TypeScript, and React app. nuqs keeps the requested project in the URL (`useQueryState('project', parseAsString)`); `useBoard` fetches, subscribes, and loads per project; one `useReducer` coordinates the applied project, pending switches, task selection, and dialogs. Component inputs use `useState`. No other state or form library is added.
- The initial selection replaces history, the menu pushes, and back and forward follow the nuqs adapter. There is no direct History API use or custom `popstate` handling.
- `pnpm --dir web build` emits `index.html`, `assets/app.js`, and `assets/app.css` under fixed names; the editor and Mermaid as dynamic chunks `assets/app-[name]-[hash].js`; and separate `access/` and `monitor/` builds with their own manifests.
- Rust embeds the fixed files and both logos. `build.rs` lists the split assets in a table in `OUT_DIR`, and only listed names are served. Missing files stop the build with `Run "pnpm --dir web build" first.`, which is why the web build comes before `cargo build`. `web/dist/` is not committed.
- Pure display functions (dates, sorting, counts) live in `web/src/lib/` with Vitest tests; components are tested with Testing Library.
- shadcn Radix components (Dialog, Button, Badge, Input, Textarea, Label, RadioGroup, DropdownMenu) live in `web/src/components/ui/`, with `cn` in `web/src/lib/utils.ts` and the `@/* → ./src/*` alias. Dialog focus is left to the library; features handle blocking close while saving, submission, and input retention. UI styles are in `styles/ui.css`; theme and product styles in `styles/theme.css`, `tokens.css`, and `app.css`.
- No external CDN or fonts are loaded; fonts come from the `--font-sans` and `--font-mono` stacks.
- Body limits, format validation, draft rules, and errors live once in `domain` and `file_store`, shared by the CLI and the server.

**Rendering user text.** Text is rendered through React's normal escaping, never `dangerouslySetInnerHTML`. Markdown becomes React elements (react-markdown, remark-gfm, without `rehype-raw`) with raw HTML shown as text. Only `http` and `https` links are active, opening in a new tab. Owned images (`assets/<id>.<ext>`, `attachment:<id>`) resolve to the image API; external images load only from `http`/`https` with `referrerpolicy="no-referrer"` and fall back to "No image". Mermaid renders with `securityLevel: 'strict'`, and only the SVG it generates is inserted.

**The editor.** `RichMarkdownEditor` (Milkdown Crepe) keeps the `MarkdownEditor` contract: `value`, `onChange`, `onCursorChange`, `disabled`, and a ref with `goTo`, `focus`, and `insert`. It loads lazily and shows `MarkdownView` meanwhile. Only CodeMirror, ListItem, ImageBlock, Cursor, Placeholder, LinkTooltip, Toolbar, and Table are enabled, without Crepe's theme. The initial value is passed once on mount; `onChange` fires only for user edits, and an untouched document is saved as the original string so unchanged Markdown is not reformatted. Uploads become pending attachments referenced as `assets/<id>.<ext>`. Mermaid previews and the viewer share `renderMermaid`.

**Themes.** `web/src/theme/index.ts` owns theme types, the list, validation, DOM attributes, and storage. A theme is a mode (light or dark) and one of 12 accents. It is applied before React renders by syncing `data-mode`, `data-accent`, the `dark` class, and `color-scheme`, and saved as `agboard.theme` in `localStorage`. Theme changes never reach the API or task history.

The epic list reads `epics` and `epicTaskCounts` from the board response. The server computes the counts from the same snapshot as the epics, so the list never mixes two reads. The mobile monitor carries the same counts in its board response, but it has no epic list screen. The list shares its frame with the archive through `ListPane`, and each state (loading, load failure, refresh failure, empty) comes from the project resource, so a failed refresh keeps the last good rows.

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

**Browser preferences**

- Language, theme, and detail panel width are stored per browser under separate keys. Missing, invalid, or unreadable values fall back to the defaults (English and the default theme and width); the browser or OS language and color scheme are never used.
- If saving fails, the choice still applies to the current page. A missing Japanese translation key shows the English string. Preference failures never change board data, and one invalid key never resets another.

## Reading across projects

`ls --all-projects` reads every project in turn. Each project is returned from before or after any concurrent save, with no consistency across projects. It never creates the data area, notifies, or changes files. Without a data area it returns empty `projects`; if any `project.json` is invalid it returns only the error, never partial output.
