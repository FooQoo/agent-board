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
| Someone on the network opens the board | `serve` listens only on `127.0.0.1`; remote access needs an explicit flag and an authenticating HTTPS proxy. | [Exposure](#exposure), [Remote access](./remote-access.md#authentication-and-write-protection) |
| A website makes the browser write to the board | Host, Origin, `Sec-Fetch-Site`, and a per-start token on every write. | [Writes from the browser](#writes-from-the-browser) |
| An agent deletes data | Deletion commands require a human y/N in a terminal; the web UI deletes only archived tasks. | [Deletion is for people](#deletion-is-for-people) |
| An agent overwrites a draft or a finished task | The CLI refuses AI writes to drafts and Done tasks. | [Drafts and Done tasks](#drafts-and-done-tasks) |
| Task text runs as code in the browser | React escaping, no raw HTML, link and image allowlists, CSP, strict Mermaid. | [Rendering untrusted text](#rendering-untrusted-text) |
| Paths or text escape their folder | IDs are validated before paths are built; text never becomes a path or shell code. | [Files and paths](#files-and-paths) |
| An agent confuses projects | Every write names one project by an immutable ProjectId. | [Project boundaries](#project-boundaries) |
| Setup grants too much | Only the data area is added; existing restrictions are kept. | [Agent access setup](#agent-access-setup) |

## Exposure

- By default `agboard serve` listens only on `127.0.0.1`, and every request must carry `Host: 127.0.0.1:<port>` or `localhost:<port>`. Users on the same machine are not authenticated.
- Only with `--remote-port` and at least one `--remote-origin` does `serve` add a listener for the common HTTPS entry, on a separate 127.0.0.1 port. Caddy (LAN, HTTPS with Basic authentication) or Tailscale Serve (HTTPS with tailnet rules) connects to that port; the local port is never forwarded, and Funnel is not used. Authentication covers the board, monitor, assets, API, SSE, and images.
- Screen width is not authorization. An authenticated user can use the full board on any device; the monitor is limited to reading and answering. How remote writes are guarded is described in [Remote access](./remote-access.md#authentication-and-write-protection).

## Writes from the browser

The local listener accepts a write (create, edit, draft toggle, epic create and update, epic membership, image upload and delete, move, answer, archive, restore, delete) only when **all** of these hold; otherwise it returns 403 and changes nothing:

1. `Host` meets the local loopback condition.
2. `Origin` is `http://127.0.0.1:<port>` or `http://localhost:<port>`.
3. `Sec-Fetch-Site` is `same-origin`.
4. `X-Agboard-Token` matches the token generated when this `serve` started (32 random bytes in hexadecimal). The token is embedded only in the HTML of `GET /` and never appears in `serve.json`, API responses, or logs.

The guard runs before the target is looked up, and the actor is always recorded as `human`. `POST /api/notify` only asks clients to re-fetch and needs no token.

These checks prove that a request came from the page in a browser. They do not stop a local program that forges headers and scrapes the token from the HTML. That is why `agboard --help` tells agents to ask a person for deletion and does not describe the API.

## Deletion is for people

- `rm`, `project rm`, `epic rm`, `evidence rm`, and `init` on a non-empty project require a human y/N confirmation in a terminal (see the [CLI guide](../../guide/automation/cli.md#output-and-confirmation)). Without a terminal, or with `--json`, they fail instead of asking. There is no option to skip confirmation.
- Deleting a project shows the name and that every task and its history will be deleted.
- The web UI physically deletes only archived tasks, after the write guard. Archiving keeps data; physical deletion removes the task folder (body, state, history, images, evidence). Copies the user made elsewhere are never touched.
- Breaking changes are allowed before the first release for development-time format changes only; they never waive these confirmations.

## Drafts and Done tasks

- CLI `edit`, `mv`, `state`, and `history add` refuse draft tasks, so a cooperative agent does not overwrite a task a person is writing.
- AI changes to Done tasks (edit, state, epic, history, evidence, images) are refused.
- Writes to archived tasks (edit, draft change, move, state, answer, attachments) are refused under the write lock; images and evidence stay readable.
- The draft toggle and edit APIs accept only requests that pass the browser write guard.
- `actor` (`ai` or `human`) classifies an operation; it is not authentication. It comes from explicit CLI input or the web side's fixed `human`, never from the assignee.

## Rendering untrusted text

Titles, descriptions, reasons, and answers are written by agents and users, so the UI treats them as untrusted.

- Text is rendered through React and never interpreted as HTML (no `dangerouslySetInnerHTML`). Markdown is rendered with raw HTML shown as text. No external scripts or fonts are loaded.
- Only `http` and `https` links are active; they open in a new tab with `noopener noreferrer`. `javascript:` and other schemes are shown as text.
- Body images resolve only to `assets/<id>.<ext>` (or `attachment:<id>`) owned by the same task or epic, through the image API that checks ProjectId, owner, and image ID. `../`, absolute paths, `file:`, `data:`, `javascript:`, other owners, other projects, and symbolic links are not shown. External images load only from `http` and `https` URLs, without a Referer.
- As defense in depth, HTML responses carry a `Content-Security-Policy` (scripts and connections from self only; images from self, `data:`, `http`, `https`), so a rendering bug cannot run external scripts. Split scripts load from the server's own `/assets/`.
- Mermaid renders with `securityLevel: 'strict'`, disabling HTML, click handlers, and scripts in diagrams.
- Evidence is served as `text/plain; charset=utf-8` with `X-Content-Type-Options: nosniff`.

## Files and paths

- Shared files are created with the OS default permissions and hold no secrets.
- Owned paths are built only after validating ProjectId (32 hexadecimal characters), task ID, EPIC-ID, image ID, and evidence ID. Names and body text never become paths or shell code.
- The absolute path of the shared area is returned only by `workspace --json`. Hooks, snapshots, and errors show relative paths only. Folder bindings stay in the machine-local data area, and `EPIC.md`/`TASK.md` paths appear only in local CLI and hook output, never in remote JSON.
- Board text is work data: it is never used as hook configuration, command arguments, or shell code. The hook and `wait` only read. Session tokens, environment variables, and settings contents never appear in snapshots.

## Project boundaries

- Naming the target every time and the immutable ProjectId keep cooperative agents from confusing projects, task numbers, or names. They are not per-project authentication or authorization.
- The task-wait selector is a mechanical filter, not an approval or authorization check. It returns a single eligible task but does not claim it or prevent a second listener from returning the same task. Agents must read the current `EPIC.md` and `TASK.md`, honor their existing approval boundaries, and re-check state before acting. The shared files remain writable by programs running as the same OS user.
- Project names and IDs in URLs are never treated as identity or permission, and there is no HTTP API for managing projects.
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

- **Programs running as the same OS user** can read, write, and delete the shared files directly, bypassing every CLI and web check. Folder write access does not physically protect `task.json`.
- **Direct edits of a draft's `TASK.md`** cannot be stopped; the README and the agent skill tell agents not to. The same applies to deleting task or epic folders and editing `task.json`, `epic.json`, or `project.json`.
- **Forged browser requests from a local program** that scrapes the token can pass the write guard.
- **External images leak views.** Every view of an external image contacts that server and reveals the view and the IP address. An image URL can also carry task content to an outside server, including when written by a malicious or hijacked agent. A person can only notice unfamiliar image URLs when opening the task.
- **Refusing AI changes to Done tasks, drafts, and archived tasks** restrains cooperative agents; it does not authenticate against direct file edits or a spoofed actor.
- **Writes based on cross-project reads** cannot be prevented by requiring `--project`, because the agent writes the name itself.
- **The lifecycle lock** prevents a second `serve` among cooperative processes; it does not authorize anything.
