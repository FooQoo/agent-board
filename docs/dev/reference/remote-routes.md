# Entrance routes

The routes served behind the ngrok entrance: the board app, which is the same app and API as on the PC. How the entry, the Host check, sessions, and the tunnel fit together is in [Remote access](../concepts/remote-access.md). The connection settings API is a local route, described in [Web API](./web-api.md#remote-connection).

## The board app through the entrance

The entrance serves the board's page and its API under the same paths as the local listener. A phone or a browser on another computer uses the board app itself; the screen is chosen by the window width (see [Server and web UI](../concepts/server-and-ui.md)).

| Route | Content |
| --- | --- |
| GET/HEAD `/` | The board page, the same HTML as on the PC but with an empty `meta[name=agboard-token]`. It holds no token, session, or board data. The ngrok warning page ends on this address after **Visit Site**. |
| GET/HEAD `/assets/{name}`, `/logo.png`, `/logo-white.png`, `/home-icon-{180,192,512}.png`, `/docs-sandbox`, `/docs-sandbox/{name}` | The content-named scripts and stylesheets, the logos, the opaque white-background Home Screen icons, and the fixed Docs sandbox page. None holds a token or board data, so they need the entrance checks but no session. |
| GET `/api/remote/session` | Shows the live session of the cookie: `csrfToken`, `expiresAt`, and `expiresInSeconds`. Without a live session, a valid `agboard_ngrok_device` cookie (a registered device, bound to this public address) opens a new session here without the passcode, answers 200 with the same body, and sets the `agboard_ngrok_session` cookie and a renewed device cookie; otherwise it is 401 `session_required` and sets nothing. A cross-site `Sec-Fetch-Site` is 403. |
| POST `/api/remote/unlock` | Trades the passcode for a session. The body is JSON, `{"code":"1234"}`, at most 256 bytes; it needs the public Origin and `Sec-Fetch-Site: same-origin` but no CSRF token. A wrong code is 403 `unlock_failed` with no hint. After five wrong codes in a row, every attempt, the right one too, is 429 `unlock_locked` until the connection is started again. A bad Origin or fetch site is 403 `forbidden`, a body that is not declared as JSON is 415, a body over 256 bytes is 413, and a body that does not parse is 400 (none of these count as a guess). A right code sets the `agboard_ngrok_session` cookie (`Path=/`) and, unless the browser already holds a registered device's cookie, a new `agboard_ngrok_device` cookie (`Secure; HttpOnly; SameSite=Lax; Path=/`, `Max-Age=34560000`), and returns the CSRF token. |
| GET `/api/remote/push` | Behind a session. Answers `{deviceRegistered, publicKey, subscribed}`: whether the session has a registered device, the public VAPID key to subscribe with, and whether the device already has a subscription. Without a registered device it answers `{"deviceRegistered": false}` and no key. |
| PUT `/api/remote/push/subscription` | Behind a session, with the CSRF token. Keeps the browser's `PushSubscription.toJSON()` body (`endpoint` and `keys.p256dh`/`keys.auth`, at most 4 KiB, JSON) for the session's device, replacing an older one. 409 `device_required` without a registered device, 400 `invalid_subscription` for an endpoint that is not a public `https` address or keys that are not valid, 400 `invalid_json`, 413, 415. Answers `{"subscribed": true}`. |
| DELETE `/api/remote/push/subscription` | Behind a session, with the CSRF token. Forgets the device's subscription (also when it had none). 409 `device_required` without a registered device. |
| GET `/manifest.webmanifest`, `/sw.js` | No session needed. The web app manifest and the service worker that lets the page receive Web Push. Both are also served on the local listener. |
| Every other `/api/` route of the [Web API](./web-api.md) | The board's own routes: Summary and Detail, events (`/api/events`), the write routes, the project docs, the guide, the preferences, and the phone notification settings. Reads need a live session. A change also needs the public Origin, `Sec-Fetch-Site: same-origin`, and the CSRF token in `X-Agboard-Csrf`; an `X-Agboard-Token` sent by a client is removed. |

- Without a session every route except the page shell and the static files above, the session route and the unlock route is 401 `session_required`, the event stream included. No cookie is set except by a right passcode or by a registered device's cookie.
- Routes that act on the PC itself are not part of the entrance, even with a session: the connection settings (`/api/monitor-connections` and the routes under it), `POST /api/notify`, and `POST /api/projects/{projectId}/docs/open` are 404 here.
- The local listener does not have `/api/remote/`; its Host, Origin, and token checks are unchanged.
- The event stream ends with the session, when the run closes, and after five minutes (the page reconnects).

## Project list and switching

A phone lists and switches projects the same way the PC does. `GET /api/projects` returns every project, and each project is read through `/api/projects/{projectId}/…` (Summary, Detail, events, and the rest of the [Web API](./web-api.md)). The page names the project in its address, `/?project=<ProjectId>`, and the board app reads it as it does on the PC. A project ID in a path selects what is read. It is not an access right: a session that passed the passcode reads every project on the PC.

## Result links

A result link is the board's own page with the target in the query: `/?project=<ProjectId>&task=<id>&result=<version>`.

| Part | Rule |
| --- | --- |
| Path | `/`. The target is never in the path or in a hash, so the page shell, the unlock request, and the reload after it all keep it. |
| `project` | A ProjectId, 32 lowercase hexadecimal digits. It selects the project exactly as `?project=` does. |
| `task` | The task ID, a positive integer. |
| `result` | The version of one of the task's results, a positive integer (see [Results](./files.md#results)). |

- **Serving.** The page shell is served for any query: `GET /` ignores it, passes only the Host check, and carries no token or board data, so a result link needs no session to load.
- **After the passcode.** `RemoteGate` shows the passcode screen in place and mounts the board afterwards. It never redirects, so the query is not lost, and there is no address to be sent to: the only target is the page itself. The board reads `task` and `result` from the query (`useResultLink`, `web/src/app/model/useResultLink.ts`).
- **Opening.** The phone opens the task's drawer on the Results tab, and the PC board selects the card and its Results tab, once the Summary lists the task. The result is scrolled to and highlighted. A damaged value, a task the project does not list, or an archived task opens the plain board. A version the task does not have shows a notice above the list of the results it has.
- **Clearing.** Closing the drawer, or choosing another project, removes `task` and `result` from the address, so a reload does not open it again.
- **Reading.** The Results tab reads `GET …/tasks/{id}/results` (see [Web API](./web-api.md)), because the Summary and Detail streams do not carry results, and shows an image from `GET …/tasks/{id}/attachments/{attachmentId}`. Both are ordinary board routes behind the session.

### History and question links

A notification can also open a task on its History tab or on one of its questions. Both are the same page with a different query, and `RemoteGate`, the Host check, and the clearing rules above apply unchanged. The service worker opens the `url` of the notification as it is, so the query reaches the page.

| Query | Opens |
| --- | --- |
| `?project=<ProjectId>&task=<id>&tab=history` | The task's drawer on the History tab (PC board: the card with its History tab). Used for a history notification. |
| `?project=<ProjectId>&task=<id>&question=<Q-n>` | The list of messages on that question, on the PC board and the phone. When the Summary's messages do not list it (answered, withdrawn), the card opens instead. Used for a question notification. |

A `result` in the query wins over `tab` and `question`. A damaged `result`, an unknown `tab` value, or a `question` that is not `Q-` and a positive number is no target and opens the plain board. `useResultLink` reads `tab` and `question` too, and removes them with `task` and `result`.

**Building a link.** Use `PublicOrigin::result_link(project_id, task_id, version)` (`src/server/monitor_connection/contracts/access.rs`), which returns `https://<host>[:port]/?project=<id>&task=<n>&result=<version>`, or `None` for a project that is not 32 lowercase hex digits or a task or version below 1. The web side has the same rule in `resultLinkUrl` (`web/src/features/tasks/results/resultLink.ts`). A push notification should carry this URL as its click target. `PublicOrigin::history_link(project_id, task_id)` and `PublicOrigin::question_link(project_id, task_id, question_id)` build the other two (`…&tab=history`, `…&question=<Q-n>`) under the same limits; `question_id` must be `Q-` and a positive number. The web side has `historyLinkQuery` and `questionLinkQuery` in the same file.

## The old monitor addresses are gone

The earlier phone monitor had its own page, API, and assets under `/monitor/`. None of them is served any more.

| Route | Answer |
| --- | --- |
| Any method on `/monitor` and on every path below `/monitor/` | 404, with or without a session, after the Host check. There is no redirect, and no old address forwards to the new one. |

- The local listener answers 404 for the same addresses.
- Every request first passes the Host check (a failure is a 403 with no reason). Every other route except the page shell, the static files, the session route, and the unlock route then needs a live session (otherwise 401 `session_required`), and a change also needs the public Origin, same-origin metadata, and the CSRF token. Unlisted paths are 404.
