# Change notifications

How a change in the files reaches browsers and waiting agents: versions, file watching, notifications, and Server-Sent Events.

## Versions and change notifications

A project's `version` is a SHA-256 over the relative paths and contents of its source files (`project.json`, `epic.json`, `PLAN.md`, `task.json`, `TASK.md`) and the file names under `assets/` and `evidence/`. Saving identical content leaves it unchanged, and returning to earlier content can reproduce an earlier version. That is fine because consumers only ask whether the version differs.

```mermaid
flowchart LR
  W[OS change event] --> Q[Per-project coalescing]
  N[POST /api/notify] --> Q
  S[serve finished a save] --> Q
  Q -->|200 ms after the last event| R[Reload that project]
  R --> V{version changed?}
  V -->|yes| B[Swap the index and send SSE changed]
  V -->|no| X[Do nothing]
```

1. `serve` resolves the data area once at startup and uses it until exit. It writes `serve.json` after it starts listening and removes it on exit.
2. It registers a recursive watcher on `shared/` before loading every project into its index. Events for dot-prefixed names, `.internal/`, and `README.md` are ignored.
3. Events are coalesced per project for 200 ms. A rescan request from the watcher reloads every project.
4. After a save that changed something, the CLI reads `serve.json` and sends `POST http://127.0.0.1:<port>/api/notify` over a plain TCP connection with a 300 ms budget, ignoring failure. Agents that edit files directly need not notify.
5. When the version changes, every connected browser receives SSE `changed` and re-fetches the project list and the current board. `wait` compares only its own project's version.
6. There is no periodic polling anywhere.

## How agent waits use events

Change waits, Pending-answer waits, and next-task waits share `src/agent/wait_engine.rs`. Each caller supplies its purpose-specific condition and an optional monotonic deadline. The engine reads the fixed ProjectId before connecting, checks again after SSE `ready`, and evaluates again after each `changed` event. It ignores changes whose snapshot does not satisfy the caller's condition.

Task mode starts its absolute idle deadline only after the initial snapshot contains no eligible task. Other-project changes and keep-alives cannot reset it. At expiry, the engine takes a final snapshot and evaluates the condition once more, so a task arriving at the boundary wins. A failed final read is an error, never an empty result. Change mode's optional timeout remains an error (`wait_timeout`); task mode's exhausted idle interval is the successful `idle_timeout` result. See [Agent integration](./agents#waiting-for-changes) for the selection predicate and output contract.

At startup, `serve` also deletes temporary files (`.<name>.tmp-*`, `.new-*`) older than one hour, never source files and never uncommitted journals.

## Live updates

Browsers subscribe to `GET /api/events`. On `ready`, `changed`, and every reconnect they re-fetch `GET /api/projects` and the current board. `ready` also carries the server's build ID; a page built from another web build reloads once its open operations end (see [Server and UI](./server-and-ui.md#how-the-web-ui-is-built)). When SSE drops, the desktop UI shows a disconnected state and relies on the browser's automatic reconnect. There is no periodic polling or reconciliation; a missed notification is caught on the next reconnect or reload. How `changed` is produced is described in [Storage and consistency](#versions-and-change-notifications).
