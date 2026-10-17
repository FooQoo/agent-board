# Remote and monitor routes

The routes served by the remote listener, including the mobile monitor. How the listeners, tokens, and proxies fit together is in [Remote access](../concepts/remote-access.md).

## Routes on the remote listener

| Route | Content |
| --- | --- |
| GET/HEAD `/`, `/assets/access/entry.js` | Token-free common entry and its first-run script. |
| GET/HEAD `/board/` and desktop assets | The normal desktop HTML and assets, with the remote token in the HTML. |
| Desktop API under `/api/projects`, GET `/api/events` | The normal board; every write goes through the remote guard. CLI-only `notify` and `health` are not served. |
| GET/HEAD `/monitor/` | Monitor HTML; the answer token is injected only when served. |
| GET/HEAD `/assets/monitor/{name}` | Only viewer assets in the monitor manifest. |
| GET/HEAD `/logo.png`, `/logo-white.png` | Logos. |
| GET `/monitor/api/projects`, `/monitor/api/projects/{projectId}/board` | Read contracts with bodies, full history, and problems. |
| GET `/monitor/api/events` | Dedicated SSE with `ready`, `changed`, and `heartbeat`. |
| POST `/monitor/api/projects/{projectId}/tasks/{id}/answer` | Answers the current request only. |
| GET `/monitor/api/projects/{projectId}/tasks/{id}/attachments/{attachmentId}` | Owned images only. |
| GET `/monitor/api/projects/{projectId}/tasks/{id}/evidence/{evidenceId}` | Owned text evidence only. |
| GET `/monitor/api/projects/{projectId}/epics/{epicId}` and its attachments | Owned epic data and images only. |

- `/monitor/api/` is split into a read router and an answer-only write router and is never merged into the desktop API. There is no fallback to the desktop router, no prefix-stripping redirect, no method override, and no alias from monitor paths to desktop assets.
- HEAD mirrors the allowed JSON and image GETs and is not offered for SSE. Unknown routes are 404 with no HTML fallback; disallowed methods on allowed routes are 405. Health, notify, archive, other writes, and file listings are not served on monitor routes.
- Reaching `/board/` and desktop assets after authentication is part of the normal board contract. Screen width is not authorization.
