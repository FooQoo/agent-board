# Monitor routes

The routes served behind the ngrok entrance: the board app, which is the same app and API as on the PC, and the old mobile monitor under `/monitor/`, which is still served. How the entry, the Host check, sessions, and the tunnel fit together is in [The mobile monitor](../concepts/remote-access.md). The connection settings API is a local route, described in [Web API](./web-api.md#mobile-connection).

## The board app through the entrance

The entrance serves the board's page and its API under the same paths as the local listener. A phone or a browser on another computer uses the board app itself; the screen is chosen by the window width (see [Server and web UI](../concepts/server-and-ui.md)).

| Route | Content |
| --- | --- |
| GET/HEAD `/` | The board page, the same HTML as on the PC but with an empty `meta[name=agboard-token]`. It holds no token, session, or board data. The ngrok warning page ends on this address after **Visit Site**. |
| GET/HEAD `/assets/{name}`, `/logo.png`, `/logo-white.png`, `/docs-sandbox`, `/docs-sandbox/{name}` | The content-named scripts and stylesheets, the logos, and the fixed Docs sandbox page. None holds a token or board data, so they need the entrance checks but no session. |
| GET `/api/remote/session` | Shows the live session of the cookie: `csrfToken`, `expiresAt`, and `expiresInSeconds`. Without a live session it is 401 `session_required`; it never starts one. A cross-site `Sec-Fetch-Site` is 403. |
| POST `/api/remote/unlock` | Trades the passcode for a session, exactly as `POST /monitor/api/unlock` does (the same body, the same answers, and the same count of wrong guesses). A right code sets the `agboard_ngrok_session` cookie (`Path=/`) and returns the CSRF token. |
| Every other `/api/` route of the [Web API](./web-api.md) | The board's own routes: Summary and Detail, events (`/api/events`), the write routes, the project docs, the guide, and the preferences. Reads need a live session. A change also needs the public Origin, `Sec-Fetch-Site: same-origin`, and the CSRF token in `X-Agboard-Csrf`; an `X-Agboard-Token` sent by a client is removed. |

- Without a session every route except the page shell and the static files above, the session route and the unlock route is 401 `session_required`, the event stream included. No cookie is set except by a right passcode.
- Routes that act on the PC itself are not part of the entrance, even with a session: the connection settings (`/api/monitor-connections` and the routes under it), `POST /api/notify`, and `POST /api/projects/{projectId}/docs/open` are 404 here.
- The local listener does not have `/api/remote/`; its Host, Origin, and token checks are unchanged.
- The event stream ends with the session, when the run closes, and after five minutes (the page reconnects), as the monitor's does.

## Routes of the old monitor

| Route | Content |
| --- | --- |
| GET/HEAD `/monitor/` | Monitor HTML. It holds no token, session, or board data. `/monitor` redirects to `/monitor/`. |
| GET `/monitor/api/session` | Shows the live session of the cookie: `csrfToken`, `expiresAt`, and `expiresInSeconds`. Without a live session it is 401 `session_required`; it never starts one. A cross-site `Sec-Fetch-Site` is 403. |
| POST `/monitor/api/unlock` | Trades the passcode for a session. The body is JSON, `{"code":"1234"}`, at most 256 bytes; it needs the public Origin and `Sec-Fetch-Site: same-origin` but no CSRF token. A right code sets the `agboard_ngrok_session` cookie and returns `csrfToken`, `expiresAt`, and `expiresInSeconds`. A wrong code is 403 `unlock_failed` with no hint. After five wrong codes in a row, every attempt, the right one too, is 429 `unlock_locked` until the connection is started again. A bad Origin or fetch site is 403 `forbidden`, a body that is not declared as JSON is 415, a body over 256 bytes is 413, and a body that does not parse is 400 (none of these count as a guess). |
| POST `/monitor/api/disconnect` | Ends the session (needs the CSRF token and the public Origin) and clears its cookie. It returns `{"disconnected": true}`; there is no sign-out address. The passcode still works afterwards. |
| GET/HEAD `/monitor/assets/monitor/{name}` | Only the content-named scripts and stylesheets in the monitor manifest, cached as immutable and gzip-compressed when accepted. Other names are 404 with `no-store`. |
| GET/HEAD `/monitor/api/projects/{projectId}/summary` | The project's Summary: tasks, epics with their progress, and problems, with no bodies. Its `version` is the `ETag`, and a matching `If-None-Match` gets 304. An unknown project is 404 `project_not_found`. See [Web API](./web-api.md#summary-and-detail). |
| GET/HEAD `/monitor/api/projects/{projectId}/tasks/{id}/detail` | One task's body, acceptance conditions, and history, as an NDJSON stream. `?sections=document` or `?sections=history` reads one part. |
| GET/HEAD `/monitor/api/projects/{projectId}/epics/{epicId}/detail` | One epic's document, as an NDJSON stream. |
| GET `/monitor/api/events?project=<projectId>` | Dedicated SSE with `ready` (carrying the monitor's build ID), `changed`, `resync`, `heartbeat`, and `preferences` (the saved language and theme, after a change). `project` is required: a missing or malformed value is 422 `invalid_value` and an unknown project is 404 `project_not_found`. Only that project's changes are sent. |
| GET `/monitor/api/preferences` | The saved language and color theme, the same JSON as the PC's `GET /api/preferences`. |
| PUT `/monitor/api/preferences` | Saves the language and theme only: `locale`, `theme`, or both. It needs the public Origin, `Sec-Fetch-Site: same-origin`, and the CSRF token, like an answer. Unknown fields and invalid values are 422 `invalid_preferences`. |
| GET `/monitor/api/projects/{projectId}/qa/{questionId}` | One question, as on the board. |
| POST `/monitor/api/projects/{projectId}/qa/answers` | Answers questions, with the same body and results as the board. There is no route to withdraw a question. |
| PUT `/monitor/api/projects/{projectId}/tasks/{id}/acceptance/{condition}` | Checks or unchecks one condition, as on the board. Only PUT. |
| GET `/monitor/api/projects/{projectId}/tasks/{id}/attachments/{attachmentId}` | Owned images only. |
| GET/HEAD `/monitor/api/projects/{projectId}/epics/{epicId}/attachments/{attachmentId}` | Owned epic images only. |

- `/monitor/api/` is split into a read router and a write router that holds only the answer, the acceptance check, and the preferences save. It is never merged into the desktop API. There is no fallback to the desktop router, no prefix-stripping redirect, no method override, and no alias from monitor paths to desktop assets.
- HEAD mirrors the allowed JSON and image GETs and is not offered for SSE. Unknown routes are 404 with no HTML fallback; disallowed methods on allowed routes are 405. Health, notify, archive, other writes, and file listings are not served on monitor routes.
- The desktop board and its API are not served under `/monitor/`; they are served at `/` and `/api/` as described above.
- There is no project list on the monitor. `/monitor/api/projects` and the whole-board route `/monitor/api/projects/{projectId}/board` are not served. Each monitor address names one project, and every read takes the project ID from the path or from `?project=`. The ID selects what is read; it is not an access right.
- Every request first passes the Host check (a failure is a 403 with no reason). Every route except the page shell, the static files, `session`, and `unlock` then needs a live session (otherwise 401 `session_required`), and a change also needs the public Origin, same-origin metadata, and the CSRF token. The writes on this entry are the answer, the acceptance check, the preferences save, and disconnect. Unlisted paths are 404.
