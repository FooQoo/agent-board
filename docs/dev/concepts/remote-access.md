# The mobile monitor

By default the board is reachable only from the same machine. The mobile monitor is a separate, read-mostly app that a phone reaches through the ngrok monitor connection. Setup steps for users are in the [mobile monitor guide](../../guide/operations/mobile-monitor.md); the routes are in [Monitor routes](../reference/remote-routes.md).

## How it is put together

```mermaid
flowchart LR
    Phone["Phone browser"] -->|HTTPS| Tunnel["ngrok tunnel"]
    Tunnel --> Entry["Monitor entry (127.0.0.1)"]
    Entry --> Shared["Shared FileStore index, watcher, changed broadcast"]
    LL["Local listener (127.0.0.1)"] --> Shared
```

- The monitor entry is a dedicated loopback listener that the connection starts and stops. It runs in the same `serve` process as the local listener and shares the lifecycle guard, the FileStore index and reader, the watcher, and the `changed` broadcast. `serve.json` keeps only the local port, so the CLI, hook, and `wait` are unaffected.
- The local listener and the monitor entry are separate surfaces. The local listener keeps its own Host, Origin, and token checks; the monitor entry never serves the desktop board.

Two kinds of state keep the surfaces apart:

| State | Holds | Never holds |
| --- | --- | --- |
| `MonitorState` | A read-only reader, a `changed` subscription, allowed hosts, and its own assets. | Any board token or write service. |
| Monitor answer router | The single answer endpoint and its write guard. | The desktop board token. |

## Authentication and write protection

**Monitor answers** pass the write guard of the answer router. The entry in front of it adds the guard's token only after its own checks succeed, so the page never holds it. An answer requires an exact Host and Origin for the connection's public HTTPS origin, `Sec-Fetch-Site: same-origin`, no forwarding or method-override header, and a constant-time token match before the target lookup. FileStore then re-checks Pending, the request ID, and the choice under its lock. Only the current request of a Todo or Doing task is accepted; Done, answered, archived, and other requests are refused.

No token ever appears in static JS or CSS, manifests, API responses, `serve.json`, or logs. All HTML and sensitive APIs send `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, and a CSP limiting scripts and connections to self with `frame-ancestors 'none'`. Scripts and stylesheets, which are named by their content and hold no token, are cached as immutable instead.

## The monitor app

- The monitor (`web/monitor.html`, `web/src/app/entry/monitor.tsx`, `web/vite.monitor.config.ts`) starts from `web/src/pages/monitor/App.tsx` only. It never imports the desktop `App.tsx`, `DetailPanel`, the editor, or the general write client. It builds into `web/dist/monitor/` with its own manifest, which `src/server/monitor/assets.rs` serves exclusively. For Mermaid it reuses the board build's `chunk-mermaid.core` chunk and every chunk it imports: they are copied into `web/dist/monitor/` unchanged, the build fails if any of them holds a module from `web/src/`, and the executable embeds the identical bytes once.
- Shared presentation components (header, task content, status labels, project switcher, theme, i18n, read-only Markdown, conditions, and history) are reused. A task heading opens a read-only drawer with Body, Conditions, History, and Epic tabs; the answer form lives on the task. The drawer and its Markdown view are a separate chunk fetched right after the list is shown, so the first load holds only the list and the answer form.
- The monitor client has catalog, board, events, owned image, and epic readers, and one answer POST. The token is read from the served HTML at runtime. There are no PATCH, PUT, or DELETE functions.
- Desktop and monitor answers share one FileStore save path: request matching under the lock, `requestAnswers` plus a history entry, index update, and notification. A successful answer leaves the task Idle in its lane.
- The drawer fixes its target by projectId, taskId, epicId, and a generation number. It reads task body and history from the snapshot and the epic body from `getEpic`, keeps each tab's scroll position, and ignores late or out-of-scope responses. A failed epic read can be retried without blocking the list or answers.

## Fetching and recovery

The monitor tries hard to show either fresh data or an honest "stale" state, without polling.

- **All Projects** fetches the catalog, then each board with at most four in parallel, then re-checks the catalog. If `catalogVersion` changed meanwhile, it starts over as a new generation. There is no point-in-time consistency across projects.
- **Problems.** Snapshot `problems` go to the view with their ProjectId. Any problem makes the view `partial`, even with HTTP 200: the summary shows "—", only readable tasks are listed, and a notice says the data has defects. Excluded tasks are never counted as zero. Projects that failed to fetch and projects with data defects are shown separately, with no repair action. Data defects alone never trigger retries, polling, or reconnects.
- **Freshness** is one of `loading`, `syncing`, `fresh`, `stale`, `partial`, `error`. The view becomes fresh only when SSE `ready` arrived, every project fetched without problems, and the heartbeat is current; `onopen` alone is not enough. If a manual GET succeeds while SSE is down, the view says the data is fetched but auto-update is stopped. The last full fetch time advances only on a complete, problem-free fetch.
- **One fetch routine** serves manual refresh, SSE notifications, and returning to the page. An `AbortController` and a generation number drop late responses, and `changed` during a fetch sets a dirty flag for one follow-up fetch.
- **SSE.** The monitor uses the browser's `EventSource`. Its SSE relays `changed`, sends `ready` with the monitor's build ID (`{"build":"…"}`), and sends `heartbeat` (data `{}`) every 15 seconds. If nothing arrives for 45 seconds while visible, the connection is marked stale and reconnects. A heartbeat never re-fetches the snapshot.
- **Visibility.** While hidden, SSE and heartbeat checks stop. On becoming visible, the monitor re-fetches and reconnects at once, merging the duplicate from `ready`. GET requests time out after 10 seconds. Retries back off at 1, 2, 5, 10, and 30 seconds and stop while hidden. Repeated catalog failures fall back to syncing or stale with the recovery timer instead of re-fetching forever.
- **Ordering.** `agentStatusChangedAt` is the run-state change time and `taskStatusChangedAt` orders Done. Relative times may refresh every minute, but that timer never re-fetches.
- Before setup completes the view shows loading, and it distinguishes zero projects or tasks from a network failure. Fetched bodies and counts are never stored in `localStorage` or a service worker.
