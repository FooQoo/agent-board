# Entrance routes

The routes served behind the ngrok entrance: the board app, which is the same app and API as on the PC. How the entry, the Host check, sessions, and the tunnel fit together is in [The mobile monitor](../concepts/remote-access.md). The connection settings API is a local route, described in [Web API](./web-api.md#mobile-connection).

## The board app through the entrance

The entrance serves the board's page and its API under the same paths as the local listener. A phone or a browser on another computer uses the board app itself; the screen is chosen by the window width (see [Server and web UI](../concepts/server-and-ui.md)).

| Route | Content |
| --- | --- |
| GET/HEAD `/` | The board page, the same HTML as on the PC but with an empty `meta[name=agboard-token]`. It holds no token, session, or board data. The ngrok warning page ends on this address after **Visit Site**. |
| GET/HEAD `/assets/{name}`, `/logo.png`, `/logo-white.png`, `/docs-sandbox`, `/docs-sandbox/{name}` | The content-named scripts and stylesheets, the logos, and the fixed Docs sandbox page. None holds a token or board data, so they need the entrance checks but no session. |
| GET `/api/remote/session` | Shows the live session of the cookie: `csrfToken`, `expiresAt`, and `expiresInSeconds`. Without a live session it is 401 `session_required`; it never starts one. A cross-site `Sec-Fetch-Site` is 403. |
| POST `/api/remote/unlock` | Trades the passcode for a session. The body is JSON, `{"code":"1234"}`, at most 256 bytes; it needs the public Origin and `Sec-Fetch-Site: same-origin` but no CSRF token. A wrong code is 403 `unlock_failed` with no hint. After five wrong codes in a row, every attempt, the right one too, is 429 `unlock_locked` until the connection is started again. A bad Origin or fetch site is 403 `forbidden`, a body that is not declared as JSON is 415, a body over 256 bytes is 413, and a body that does not parse is 400 (none of these count as a guess). A right code sets the `agboard_ngrok_session` cookie (`Path=/`) and returns the CSRF token. |
| Every other `/api/` route of the [Web API](./web-api.md) | The board's own routes: Summary and Detail, events (`/api/events`), the write routes, the project docs, the guide, and the preferences. Reads need a live session. A change also needs the public Origin, `Sec-Fetch-Site: same-origin`, and the CSRF token in `X-Agboard-Csrf`; an `X-Agboard-Token` sent by a client is removed. |

- Without a session every route except the page shell and the static files above, the session route and the unlock route is 401 `session_required`, the event stream included. No cookie is set except by a right passcode.
- Routes that act on the PC itself are not part of the entrance, even with a session: the connection settings (`/api/monitor-connections` and the routes under it), `POST /api/notify`, and `POST /api/projects/{projectId}/docs/open` are 404 here.
- The local listener does not have `/api/remote/`; its Host, Origin, and token checks are unchanged.
- The event stream ends with the session, when the run closes, and after five minutes (the page reconnects).

## Project list and switching

A phone lists and switches projects the same way the PC does. `GET /api/projects` returns every project, and each project is read through `/api/projects/{projectId}/…` (Summary, Detail, events, and the rest of the [Web API](./web-api.md)). The page names the project in its address, `/?project=<ProjectId>`, and the board app reads it as it does on the PC. A project ID in a path selects what is read. It is not an access right: a session that passed the passcode reads every project on the PC.

## The old monitor addresses are gone

The earlier mobile monitor had its own page, API, and assets under `/monitor/`. None of them is served any more.

| Route | Answer |
| --- | --- |
| Any method on `/monitor` and on every path below `/monitor/` | 404, with or without a session, after the Host check. There is no redirect, and no old address forwards to the new one. |

- The local listener answers 404 for the same addresses.
- Every request first passes the Host check (a failure is a 403 with no reason). Every other route except the page shell, the static files, the session route, and the unlock route then needs a live session (otherwise 401 `session_required`), and a change also needs the public Origin, same-origin metadata, and the CSRF token. Unlisted paths are 404.
