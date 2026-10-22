# Monitor routes

The routes served behind the ngrok monitor entry, including the mobile monitor. How the entry, the Host check, sessions, and the tunnel fit together is in [The mobile monitor](../concepts/remote-access.md). The connection settings API is a local route, described in [Web API](./web-api.md#mobile-connection).

## Routes on the monitor entry

| Route | Content |
| --- | --- |
| GET/HEAD `/` | Forwards to `/monitor/` with 308. The ngrok warning page ends on this address after **Visit Site**, so it must lead to the monitor. |
| GET/HEAD `/monitor/` | Monitor HTML. It holds no token, session, or board data. `/monitor` redirects to `/monitor/`. |
| GET `/monitor/api/session` | Shows the live session of the cookie: `csrfToken`, `expiresAt`, and `expiresInSeconds`. Without a live session it is 401 `session_required`; it never starts one. A cross-site `Sec-Fetch-Site` is 403. |
| POST `/monitor/api/unlock` | Trades the passcode for a session. The body is JSON, `{"code":"1234"}`, at most 256 bytes; it needs the public Origin and `Sec-Fetch-Site: same-origin` but no CSRF token. A right code sets the `agboard_ngrok_session` cookie and returns `csrfToken`, `expiresAt`, and `expiresInSeconds`. A wrong code is 403 `unlock_failed` with no hint. After five wrong codes in a row, every attempt, the right one too, is 429 `unlock_locked` until the connection is started again. A bad Origin or fetch site is 403 `forbidden`, a body that is not declared as JSON is 415, a body over 256 bytes is 413, and a body that does not parse is 400 (none of these count as a guess). |
| POST `/monitor/api/disconnect` | Ends the session (needs the CSRF token and the public Origin) and clears its cookie. It returns `{"disconnected": true}`; there is no sign-out address. The passcode still works afterwards. |
| GET/HEAD `/monitor/assets/monitor/{name}` | Only the content-named scripts and stylesheets in the monitor manifest, cached as immutable and gzip-compressed when accepted. Other names are 404 with `no-store`. |
| GET/HEAD `/logo-white.png` | The header logo. It needs the entrance checks but no session. |
| GET/HEAD `/monitor/api/projects/{projectId}/summary` | The project's Summary: tasks, epics with their progress, and problems, with no bodies. Its `version` is the `ETag`, and a matching `If-None-Match` gets 304. An unknown project is 404 `project_not_found`. See [Web API](./web-api.md#summary-and-detail). |
| GET/HEAD `/monitor/api/projects/{projectId}/tasks/{id}/detail` | One task's body, acceptance conditions, and history, as an NDJSON stream. `?sections=document` or `?sections=history` reads one part. |
| GET/HEAD `/monitor/api/projects/{projectId}/epics/{epicId}/detail` | One epic's document, as an NDJSON stream. |
| GET `/monitor/api/events?project=<projectId>` | Dedicated SSE with `ready` (carrying the monitor's build ID), `changed`, `resync`, `heartbeat`, and `preferences` (the saved language and theme, after a change). `project` is required: a missing or malformed value is 422 `invalid_value` and an unknown project is 404 `project_not_found`. Only that project's changes are sent. |
| GET `/monitor/api/preferences` | The saved language and color theme, the same JSON as the PC's `GET /api/preferences`. |
| PUT `/monitor/api/preferences` | Saves the language and theme only: `locale`, `theme`, or both. It needs the public Origin, `Sec-Fetch-Site: same-origin`, and the CSRF token, like an answer. Unknown fields and invalid values are 422 `invalid_preferences`. |
| POST `/monitor/api/projects/{projectId}/tasks/{id}/answer` | Answers the current request only. |
| GET `/monitor/api/projects/{projectId}/tasks/{id}/attachments/{attachmentId}` | Owned images only. |
| GET/HEAD `/monitor/api/projects/{projectId}/epics/{epicId}/attachments/{attachmentId}` | Owned epic images only. |

- `/monitor/api/` is split into a read router and a write router that holds only the answer and the preferences save. It is never merged into the desktop API. There is no fallback to the desktop router, no prefix-stripping redirect, no method override, and no alias from monitor paths to desktop assets.
- HEAD mirrors the allowed JSON and image GETs and is not offered for SSE. Unknown routes are 404 with no HTML fallback; disallowed methods on allowed routes are 405. Health, notify, archive, other writes, and file listings are not served on monitor routes.
- The desktop board and its API are not served on the monitor entry.
- There is no project list on the monitor. `/monitor/api/projects` and the whole-board route `/monitor/api/projects/{projectId}/board` are not served. Each monitor address names one project, and every read takes the project ID from the path or from `?project=`. The ID selects what is read; it is not an access right.
- Every request first passes the Host check (a failure is a 403 with no reason). Every `/monitor/api/` route except `session` and `unlock` then needs a live session (otherwise 401 `session_required`), and a change also needs the public Origin, same-origin metadata, and the CSRF token. The writes on this entry are the answer, the preferences save, and disconnect. Unlisted paths are 404.
