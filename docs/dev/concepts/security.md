# Security model

Agent Board is a local tool for one person working with cooperative agents. This page states what it protects, how each protection works, and what it deliberately does not prevent. Read it before changing anything that writes data, serves content, or touches agent settings.

## Assumptions and goals

- There is one user. Agents on the same machine are cooperative: they read the rules and follow them. Full protection against malicious programs is not a goal.
- Two things are protected:
  1. Task contents are neither visible to nor changeable by other people on the network or by external websites.
  2. Agents do not accidentally cross the line that **deletion is for people only**.

Everything below serves one of these two goals. When a protection only restrains cooperative agents, it says so.

## Protections at a glance

| Risk | Protection | Details |
| --- | --- | --- |
| Someone on the network opens the board | `serve` listens only on `127.0.0.1`; the phone connection starts only on request and is guarded by a 4-digit passcode made for each start, with a limit on wrong guesses. | [Exposure](#exposure), [The ngrok entrance](#the-ngrok-entrance) |
| A website makes the browser write to the board | Host, Origin, `Sec-Fetch-Site`, and a per-start token on every write. | [Writes from the browser](#writes-from-the-browser) |
| An agent deletes data | Deletion commands require a human y/N in a terminal; the web UI deletes only archived tasks. | [Deletion is for people](#deletion-is-for-people) |
| An agent overwrites a draft or a finished task | The CLI refuses AI writes to drafts and Done tasks. | [Drafts and Done tasks](#drafts-and-done-tasks) |
| Task text runs as code in the browser | React escaping, no raw HTML, link and image allowlists, CSP, strict Mermaid. | [Rendering untrusted text](#rendering-untrusted-text) |
| Paths or text escape their folder | IDs are validated before paths are built; text never becomes a path or shell code. | [Files and paths](#files-and-paths) |
| A docs path reaches outside `docs/` | Paths are checked element by element, symbolic links are refused, and only `.md` files and four image types are served. | [Project docs](#project-docs) |
| An agent confuses projects | Every write names one project by an immutable ProjectId. | [Project boundaries](#project-boundaries) |
| Setup grants too much | Only the data area is added; existing restrictions are kept. | [Agent access setup](#agent-access-setup) |

## Exposure

- By default `agboard serve` listens only on `127.0.0.1`, and every request must carry `Host: 127.0.0.1:<port>` or `localhost:<port>`. Users on the same machine are not authenticated.
- Only when the ngrok monitor connection is started does the server add a separate loopback entry for the monitor, which ngrok forwards to. The local port is never forwarded. The entry serves only the monitor, its assets, and its read, answer, and preferences routes; it never serves the desktop board.
- The monitor is limited to reading, answering, and saving the language and color theme. It cannot change tasks, projects, or connection settings. The checks in front of it are described in [The ngrok entrance](#the-ngrok-entrance).
- The connection settings API (`/api/monitor-connections`) is on the local listener only. A phone can never start, stop, or reconfigure the connection.

## The ngrok entrance

Anyone who can open the ngrok address reaches ngrok's Edge first, not the board. The endpoint is opened without a Traffic Policy, because the free ngrok plan rejects one, so the Edge does no sign-in and adds nothing. A request must pass every layer below, in order. The layers and the lifecycle are described in [The mobile monitor](./remote-access.md#authentication-and-write-protection).

| Layer | What it checks | What it stops |
| --- | --- | --- |
| Host | The endpoint is opened without a Traffic Policy, so the Edge adds nothing. The `Host` header must be exactly the public HTTPS address; anything else gets the same 403. | A browser or a website that reaches the loopback port (its `Host` is the loopback address or another name), a request for another Host, and a forged `ngrok-auth-user-*` or `X-Forwarded-*` header. |
| Passcode and session | A 4-digit passcode made for each start opens an in-memory application session (`agboard_ngrok_session`, `Secure; HttpOnly; SameSite=Lax; Path=/monitor/`, at most 12 hours) bound to this start and address. The passcode is compared in constant time; five wrong ones in a row end all attempts until the next start. | Reading the monitor API without having been given the passcode; guessing more than five times per start; reusing a session after a stop or a restart. |
| CSRF and Origin | For an answer, a preferences save, or disconnect: the exact public Origin, `Sec-Fetch-Site: same-origin`, and a CSRF token derived from the session. | A website that makes the phone's browser send an answer or a preferences save. |

- The monitor is not guarded by Google or any account. The passcode is a shared secret between the PC's screen and the phone, so it is weaker than a sign-in: 10,000 possibilities, protected by the guess limit and its short life. The app does not accept the Edge's identity headers, `Forwarded`, or `X-Forwarded-*` as proof of anything; they are removed after the Host check.
- The passcode is shown to the PC only: in the local status answer while the connection is `ready`, in the connection dialog, and on the `serve` startup line. It is never written to a file, a log, `serve.json`, the page, or an error; the failed-guess count is never reported.
- The passcode, sessions, CSRF tokens, and the ngrok token live only in memory. Stopping, starting again, or restarting the server drops them, ends open event streams, and makes a new passcode with a clean count.
- The ngrok token is accepted only in the body of the local start request, is never returned or written to the settings file, and, when the user chooses to keep it, is stored in the PC's secure storage (the OS credential store). The `NGROK_AUTHTOKEN` environment variable takes priority over a saved token.
- **Traffic Inspector.** ngrok ends the HTTPS connection, so it can process traffic, and its Traffic Inspector keeps request and response details when **Full Capture** is enabled for the account. Agent Board cannot turn that off; the user checks that it is disabled in the ngrok dashboard under **Settings** → **Observability**.
- The monitor serves no desktop route, no edit or archive route, and no file listing. Unknown routes are 404 and disallowed methods are 405, and authentication is evaluated before the target is looked up.

## Saved language and color theme

The language and color theme are saved on the PC in `<data root>/.internal/preferences.json`. Two routes write them: the PC's `PUT /api/preferences`, which passes the write guard below, and the monitor's `PUT /monitor/api/preferences`, which passes the entrance checks above.

- The monitor's save needs the same checks as an answer: the Host check, a live passcode session, the exact public Origin, `Sec-Fetch-Site: same-origin`, and the CSRF token.
- The route accepts only `locale` and `theme`. In a well-formed JSON object, any other field or a value that is not allowed is refused with `invalid_preferences`. Malformed JSON is refused with 400 `invalid_json`, and a body that is not JSON content is refused with 415. Nothing is saved in any of these cases.
- The saved values are not secret: a language and a color. The file is owner-only, and it holds no token, passcode, or session.
- What is protected is the limit itself. The monitor can change these two settings and nothing else.
- What is not protected: a phone that is allowed in, or someone who takes over its session, can change the PC's language and theme, and every open page then shows the new choice. Tasks, projects, and connection settings stay out of reach.

## Writes from the browser

The local listener accepts a write (create, edit, draft toggle, epic create and update, epic membership, image upload and delete, move, answer, archive, restore, delete, and the saved language and theme) only when **all** of these hold; otherwise it returns 403 and changes nothing:

1. `Host` meets the local loopback condition.
2. `Origin` is `http://127.0.0.1:<port>` or `http://localhost:<port>`.
3. `Sec-Fetch-Site` is `same-origin`.
4. `X-Agboard-Token` matches the token generated when this `serve` started (32 random bytes in hexadecimal). The token is embedded only in the HTML of `GET /` and never appears in `serve.json`, API responses, or logs.

The guard runs before the target is looked up, and the actor is always recorded as `human`. `POST /api/notify` only asks clients to re-fetch and needs no token.

These checks prove that a request came from the page in a browser. They do not stop a local program that forges headers and scrapes the token from the HTML. That is why `agboard --help` tells agents to ask a person for deletion and does not describe the API.

## Deletion is for people

- `rm`, `project rm`, `epic rm`, and `init` on a non-empty project require a human y/N confirmation in a terminal (see the [CLI guide](../../guide/automation/cli.md#output-and-confirmation)). Without a terminal, or with `--json`, they fail instead of asking. There is no option to skip confirmation.
- Deleting a project shows the name and that every task and its history will be deleted.
- The web UI physically deletes only archived tasks, after the write guard. Archiving keeps data; physical deletion removes the task folder (body, state, history, and images). Copies the user made elsewhere are never touched.
- Breaking changes are allowed before the first release for development-time format changes only; they never waive these confirmations.

## Drafts and Done tasks

- CLI `edit`, `mv`, `state`, and `history add` refuse draft tasks, so a cooperative agent does not overwrite a task a person is writing.
- AI changes to Done tasks (edit, state, epic, history, and images) are refused.
- Writes to archived tasks (edit, draft change, move, state, answer, and attachments) are refused under the write lock; images stay readable.
- The draft toggle and edit APIs accept only requests that pass the browser write guard.
- `actor` (`ai` or `human`) classifies an operation; it is not authentication. It comes from explicit CLI input or the web side's fixed `human`, never from the assignee.

## Rendering untrusted text

Titles, descriptions, reasons, and answers are written by agents and users, so the UI treats them as untrusted.

- Text is rendered through React and never interpreted as HTML (no `dangerouslySetInnerHTML`). Markdown is rendered with raw HTML shown as text. No external scripts or fonts are loaded.
- Only `http` and `https` links are active; they open in a new tab with `noopener noreferrer`. `javascript:` and other schemes are shown as text.
- Body images resolve only to `assets/<id>.<ext>` (or `attachment:<id>`) owned by the same task or epic, through the image API that checks ProjectId, owner, and image ID. `../`, absolute paths, `file:`, `data:`, `javascript:`, other owners, other projects, and symbolic links are not shown. External images load only from `http` and `https` URLs, without a Referer.
- As defense in depth, HTML responses carry a `Content-Security-Policy` (scripts and connections from self only; images from self, `data:`, `http`, `https`), so a rendering bug cannot run external scripts. Split scripts load from the server's own `/assets/`.
- Mermaid renders with `securityLevel: 'strict'`, disabling HTML, click handlers, and scripts in diagrams.

## Files and paths

- Shared files are created with the OS default permissions and hold no secrets.
- Owned paths are built only after validating ProjectId (32 hexadecimal characters), task ID, EPIC-ID, and image ID. Names and body text never become paths or shell code.
- The absolute path of the shared area is returned only by `workspace --json`. Hooks, snapshots, and errors show relative paths only. Folder bindings stay in the machine-local data area, and `EPIC.md`/`TASK.md` paths appear only in local CLI and hook output, never in remote JSON.
- Board text is work data: it is never used as hook configuration, command arguments, or shell code. The hook and `wait` only read. Session tokens, environment variables, and settings contents never appear in snapshots.

## Project docs

The docs routes read files chosen by a path in the request, and one route opens a file in the computer's own app, so they check the path before any file is touched (`src/docs/paths.rs`). Nothing in the board writes to the docs.

What is refused:

- **Path text.** An empty path, an absolute path, an empty part (`a//b`), any part that starts with a dot (`..`, `.git`), a backslash, a control character such as NUL, a part over 255 bytes, a path over 1,024 bytes, and more than 17 parts are `docs_path_invalid`. The file route also requires the last part to end in `.md` or `.mdx` (`docs_not_markdown`).
- **Symbolic links.** The path is resolved one part at a time under the project's `docs/`, and a symbolic link at any step, the file or a folder above it, is refused. The file is then opened with `O_NOFOLLOW` on Unix, and the opened handle must be a regular file. The tree leaves symbolic links out, so the page never offers one.
- **Content types.** The file routes read only UTF-8 text up to 2 MiB. The image route serves only PNG, JPEG, WebP, GIF, AVIF, and SVG up to 10 MiB, with a `Content-Type` fixed by the extension and `X-Content-Type-Options: nosniff`, so an HTML file is never served as something a browser could run. An SVG can carry script, so its response also has `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`, and the page shows it in an `<img>`.
- **Opening.** `POST docs/open` passes the same write guard as every board write (Host, Origin, `Sec-Fetch-Site`, and the token), because it starts a program on the computer. With `?path=`, the path is checked as a read checks it, and only an existing regular file is handed to the operating system's opener (`open`, `explorer`, or `xdg-open`) as a single argument, never through a shell. The app the operating system picks then runs with the user's rights, as if the user had double-clicked the file.
- **No writes.** There is no route that writes, creates, renames, or deletes a file in the docs. A `PUT` to the file route is refused (405).
- **Exposure.** The routes are on the board router only. The monitor entry that ngrok forwards to has no docs routes, so a phone cannot read or change the docs.

The root folder comes from the server's own data area and the ProjectId in the URL, never from the request body. The folder is the user's: Agent Board writes only the README, when it creates the folder.

### MDX in the Docs

An `.mdx` file can hold code: expressions such as `{1 + 2}` run when the file is drawn. The board page never runs it. Its policy has no `unsafe-eval`, and the MDX compiler is not in its scripts.

The body is run by a separate page, `GET /docs-sandbox`, shown in an iframe with `sandbox="allow-scripts"` and without `allow-same-origin`. The iframe gets an opaque origin, so the code in it cannot read the board's DOM, `localStorage`, session token, or cookies, and cannot call the board's API. The page is fixed: it holds no token and no board data. The board sends it the MDX text with `postMessage`; the page accepts a message only from the window that embeds it, and the board accepts a reply only from that iframe.

The page has its own policy (`connect-src 'none'`, no framing, no forms, no base URL). Only this page has `'unsafe-eval'`, because the MDX compiler builds code at run time. The board's own policy gains `frame-src 'self'` so that it may embed the page, and nothing else.

What this protects: the token and the files stay out of reach of a document's code, and the code cannot send anything out. What it does not: an endless loop or heavy work inside the iframe is not stopped and can slow the browser tab until the user chooses another file or closes the Docs. Parts are registered by name, and only standard HTML elements are registered; any other part is drawn as "Unregistered component". The page cannot be opened from the phone, because the monitor has no such route.

## Project boundaries

- Naming the target every time and the immutable ProjectId keep cooperative agents from confusing projects, task numbers, or names. They are not per-project authentication or authorization.
- The task-wait selector is a mechanical filter, not an approval or authorization check. It returns a single eligible task but does not claim it or prevent a second listener from returning the same task. Agents must read the current `EPIC.md` and `TASK.md`, honor their existing approval boundaries, and re-check state before acting. The shared files remain writable by programs running as the same OS user.
- Project names and IDs in URLs are never treated as identity or permission, and there is no HTTP API for managing projects.
- A ProjectId in a path, or in the monitor's `?project=`, selects what the request reads or the stream carries. It is not an access right. The monitor has no per-project permission: a session that has passed the passcode can read the Summary and Detail of every project on the PC, and the project in the address only decides which one the page shows.
- `ls --all-projects` is read-only and returns every project's tasks and history; with everything running as the same OS user, it does not narrow what it reads. Writes, the hook, and `wait` still target exactly one explicit project.
- The hook gives only the progress table of the project bound to its `cwd` and never selects all projects implicitly. Templates and the generic skill never embed a project name or absolute path.

## Agent access setup

`setup` adds only the resolved Agent Board data area, never the whole home directory or other folders. That grants the agent access to all of the user's board data, so it is applied to the agent's user settings.

- Existing allow, deny, and ask rules, permission modes, models, hooks, and network settings are preserved. Full access, `bypassPermissions`, blanket Bash permissions, and relaxed managed policies are never added. If the folder cannot be added under the current scheme, setup does not report success.
- Backups and temporary files may contain the same sensitive settings, so existing access restrictions are not widened.
- Project, application, or organization settings may take precedence over user settings, so updating a file does not guarantee access; users confirm in a session.
- The resolved absolute path is stored only in the user's local settings, never in shared templates or project documents.

## What is not prevented

These limits are deliberate. Keep them in mind when someone asks for "just one more check".

- **ngrok and its account owner.** The tunnel is not end-to-end encrypted: ngrok ends the HTTPS connection, so ngrok can see the traffic, and an administrator of the ngrok account can change how the address is served.
- **A local process that sends HTTP straight to the monitor's loopback port.** The monitor's entry listens on `127.0.0.1` on a random port, and nothing proves that a request came through ngrok: a program on the PC that sends `Host: <the public address>` to that port is admitted past the Host check. Its only way on is the passcode and the session behind it, so the board's data stays unreadable without the passcode, but such a program can guess (five tries per start) and can spend those tries, which locks the phone out until the connection is started again. The user who runs the PC is trusted: the same programs can read the shared files directly, so no further defence is added for this path. A website cannot do it, because a browser cannot send another `Host`.
- **A phone that is allowed in, or someone who takes over its session.** Such a person can change the PC's language and color theme through the monitor. This is the only setting the monitor can change; tasks, projects, and connection settings stay out of reach.
- **Anyone who has the address and the passcode.** Whoever enters the passcode can read every project's monitor data, answer the current question of a Todo or Doing task, and change the language and color theme, for up to 12 hours. A 4-digit passcode has 10,000 possibilities; the limit of five wrong guesses in a row and the new passcode at each start make guessing hard, but not impossible: an attacker who finds the address gets five guesses per start, and one right guess opens it. Someone who sees the passcode on the PC's screen or the startup line can use it. Keep the address private and stop the connection when it is not needed.
- **Programs running as the same OS user** can read, write, and delete the shared files directly, bypassing every CLI and web check. Folder write access does not physically protect `task.json`.
- **Direct edits of a draft's `TASK.md`** cannot be stopped; the README and the agent skill tell agents not to. The same applies to deleting task or epic folders and editing `task.json`, `epic.json`, or `project.json`.
- **Forged browser requests from a local program** that scrapes the token can pass the write guard.
- **External images leak views.** Every view of an external image contacts that server and reveals the view and the IP address. An image URL can also carry task content to an outside server, including when written by a malicious or hijacked agent. A person can only notice unfamiliar image URLs when opening the task.
- **Refusing AI changes to Done tasks, drafts, and archived tasks** restrains cooperative agents; it does not authenticate against direct file edits or a spoofed actor.
- **Writes based on cross-project reads** cannot be prevented by requiring `--project`, because the agent writes the name itself.
- **A docs folder swapped between the check and the open.** The path check and the open are separate steps, and only the standard library is used. A program that replaces a folder inside `docs/` with a symbolic link after the check and before the open can make the server read or write through that link. The final `O_NOFOLLOW` protects only the last part of the path. Such a program already runs as the same user and can change the files directly.
- **Opening a docs file.** **Open in editor** starts whatever app the operating system assigns to the file's type, with the user's rights. A file someone placed in `docs/` can be opened this way, as if the user double-clicked it in the file manager.
- **The `docs/` folder itself.** The checks start below `docs/`. The data area, the project folder, and `docs/` itself are trusted, as for every other shared file.
- **The lifecycle lock** prevents a second `serve` among cooperative processes; it does not authorize anything.
