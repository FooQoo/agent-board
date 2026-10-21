# Monitor routes

The routes served behind the ngrok monitor entry, including the mobile monitor. How the entry, the proof, sessions, and the tunnel fit together is in [The mobile monitor](../concepts/remote-access.md). The connection settings API is a local route, described in [Web API](./web-api.md#mobile-connection).

## Routes on the monitor entry

| Route | Content |
| --- | --- |
| GET/HEAD `/monitor/` | Monitor HTML. It holds no token, session, or board data. `/monitor` redirects to `/monitor/`. |
| GET `/monitor/api/session` | Starts or reuses the application session. Sets the `agboard_ngrok_session` cookie and returns `csrfToken`, `expiresAt`, and `expiresInSeconds`. |
| POST `/monitor/api/disconnect` | Ends the session (needs the CSRF token and the public Origin) and returns `logoutPath` for ngrok's sign-out. |
| GET/HEAD `/assets/monitor/{name}` | Only the content-named scripts and stylesheets in the monitor manifest, cached as immutable and gzip-compressed when accepted. Other names are 404 with `no-store`. |
| GET/HEAD `/logo-white.png` | The header logo. It needs the entrance checks but no session. |
| GET `/monitor/api/projects`, `/monitor/api/projects/{projectId}/board` | Read contracts with bodies, full history, and problems. |
| GET `/monitor/api/events` | Dedicated SSE with `ready` (carrying the monitor's build ID), `changed`, and `heartbeat`. |
| POST `/monitor/api/projects/{projectId}/tasks/{id}/answer` | Answers the current request only. |
| GET `/monitor/api/projects/{projectId}/tasks/{id}/attachments/{attachmentId}` | Owned images only. |
| GET `/monitor/api/projects/{projectId}/epics/{epicId}` and its attachments | Owned epic data and images only. |

- `/monitor/api/` is split into a read router and an answer-only write router and is never merged into the desktop API. There is no fallback to the desktop router, no prefix-stripping redirect, no method override, and no alias from monitor paths to desktop assets.
- HEAD mirrors the allowed JSON and image GETs and is not offered for SSE. Unknown routes are 404 with no HTML fallback; disallowed methods on allowed routes are 405. Health, notify, archive, other writes, and file listings are not served on monitor routes.
- The desktop board and its API are not served on the monitor entry.
- Every request first passes the proof and Host checks (a failure is a 403 with no reason). Every `/monitor/api/` route except `session` then needs a live session (otherwise 401 `session_required`), and a change also needs the public Origin, same-origin metadata, and the CSRF token. Unlisted paths are 404.
