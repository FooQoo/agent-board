# Error codes

Every failure has a stable machine-readable `code`, a one-line `message`, and a `reason` that says what to do. The CLI prints them (with `--json`, as `{"error": {...}}`) and exits with a code; the web API returns them with an HTTP status. The codes are defined in `src/error.rs`.

For causes and fixes of the common ones, see [Troubleshooting](../troubleshooting.md).

## Tasks and states

| Code | When | Exit | HTTP |
| --- | --- | --- | --- |
| `task_not_found` | The task ID does not exist in the project. | 3 | 404 |
| `task_archived` | A write targets an archived task. | 1 | 409 |
| `task_not_archived` | A delete or restore targets a task that is not archived. | 1 | 409 |
| `task_is_draft` | An AI write (`edit`, `mv`, `state`, `history add`) targets a draft. | 1 | 409 |
| `task_not_draft` | A web edit targets a task that is not a draft. | 1 | 409 |
| `task_is_done` | An AI change targets a Done task. | 1 | 409 |
| `acceptance_unmet` | An AI moves a task to Done while a condition is unmet or the frontmatter is invalid. | 2 | n/a |
| `invalid_state_for_column` | The run state is not valid in that lane (for example Running in Todo). | 1 | 422 |
| `invalid_state_for_assignee` | A human task is given a run state other than Idle. | 2 | 422 |
| `invalid_state_for_draft` | A running task is made a draft. | 1 | 409 |
| `archive_targets_changed` | A bulk archive target moved or was deleted since the confirmation opened. | 1 | 409 |

## Decision requests

| Code | When | Exit | HTTP |
| --- | --- | --- | --- |
| `request_changed` | The answer names a request that is no longer current, or a waiting request was withdrawn by a task move. | 1 | 409 |
| `request_choice_unknown` | The answer names a choice that is not in the request. | 2 | 422 |

## Projects, epics, and attachments

| Code | When | Exit | HTTP |
| --- | --- | --- | --- |
| `project_not_found` | No project matches the name or ID. | 4 | 404 |
| `project_name_exists` | A project with the same name exists. | 2 | 409 |
| `folder_unbound` | The working folder is not bound to a project. | 4 | n/a |
| `bound_project_missing` | The project bound to the folder no longer exists. | 4 | n/a |
| `folder_bound_elsewhere` | The folder already belongs to another project. | 2 | n/a |
| `epic_not_found` | The EPIC-ID does not exist. | 1 | 404 |
| `epic_id_taken` | An epic with the same EPIC-ID exists. | 1 | 409 |
| `epic_in_use` | A task still refers to the epic. | 1 | 409 |
| `attachment_not_found` | The image ID does not exist. | 1 | 404 |
| `attachment_limit_exceeded` | An image is too large, or the owner has too many images. | 1 | 422 |

## Input and files

| Code | When | Exit | HTTP |
| --- | --- | --- | --- |
| `invalid_argument` | A command argument is missing or malformed; for example, `--no-wait` with an integer `timeoutSeconds`. | 2 | 422 |
| `invalid_value` | A value breaks a rule (length, format, and so on). | 2 | 422 |
| `confirmation_required` | A deletion needs a human y/N in a terminal. | 1 | n/a |
| `file_invalid` | A shared file is malformed or breaks the format. | 1 | 422 |
| `format_unsupported` | A shared file has a `formatVersion` other than 1. | 1 | 500 |
| `file_unreadable` | A shared file cannot be read. | 1 | 500 |
| `file_error` | A shared file cannot be written, or a journal cannot be recovered. | 1 | 500 |
| `database_busy` | The project write lock was not free within 5 seconds. | 1 | 503 |
| `database_error` | An unexpected failure while reading or writing. | 1 | 500 |

## Server and waiting

| Code | When | Exit | HTTP |
| --- | --- | --- | --- |
| `already_serving` | Another `serve` already runs on this data area. | 1 | n/a |
| `port_in_use` | The port is taken. | 1 | n/a |
| `board_unavailable` | A waiting Pending request, `wait`, or the hook cannot reach the server. A Pending request checks the server before saving, so an unavailable server leaves no question. | 1 | n/a |
| `cursor_invalid` | The cursor is malformed or belongs to another project. | 1 | n/a |
| `wait_timeout` | Change mode (`wait --after`) reached its optional `--timeout` with no change, or a Pending request reached its integer `wait.timeoutSeconds`. It is not an answer; the question stays Pending. | 1 | n/a |
| `forbidden` | A web write failed the guard (Host, Origin, `Sec-Fetch-Site`, or token). | n/a | 403 |

## Mobile connection

These are returned by the `/api/monitor-connections` routes (see [Web API](./web-api.md#mobile-connection)) and carry no secret value.

| Code | When | Exit | HTTP |
| --- | --- | --- | --- |
| `revision_conflict` | The settings changed since the page read them. | n/a | 409 |
| `save_failed` | The settings could not be saved. Nothing changed and nothing started. | n/a | 500 |
| `token_required` | A start found no token in the request, the environment, or the secure storage. | n/a | 422 |
| `keychain_unavailable` | Saving or deleting the token was asked for but the PC's secure storage cannot do it. Nothing was saved or changed. | n/a | 409 |
| `settings_unreadable` | A start while the saved settings file cannot be read. Save the settings again first. | n/a | 409 |
| `start_failed` | The connection could not be started for an internal reason. | n/a | 500 |
| `invalid_value` | The token or the body breaks a rule (for example `save` without a token, or an unknown field). | n/a | 422 |

On the command line, `serve --monitor ngrok` with a missing or invalid option exits 2 with `invalid_argument`; a connection that cannot start exits 1. The failure codes in the state object (`failure`) are listed in [Web API](./web-api.md#mobile-connection).

On the monitor entry, a request that fails the Host check gets a 403 `forbidden` with the reason `not available`, a missing or expired session gets 401 `session_required`, and a write without the public Origin, same-origin metadata, or CSRF token gets 403 `forbidden`. `POST /monitor/api/unlock` answers a wrong passcode with 403 `unlock_failed` and, after five wrong ones in a row, every attempt with 429 `unlock_locked`; neither says how many tries are left.

## Display preferences

These are returned by the `/api/preferences` and `/monitor/api/preferences` routes (see [Web API](./web-api.md#display-preferences)). They are not CLI errors, so they have no exit code. A preferences file that cannot be read is not an error: the defaults are used.

| Code | When | Exit | HTTP |
| --- | --- | --- | --- |
| `invalid_preferences` | The body has an unknown field, a value that is not allowed, or neither `locale` nor `theme`. Nothing is saved. | n/a | 422 |
| `preferences_unavailable` | The preferences file could not be written. The saved value is unchanged. | n/a | 500 |

## First-run guide

- `onboarding_conflict` (409): the guide changed since the tab read it, another tab holds the lease, or the run is not the active one. Read the state again and repeat the step with the current revision.
- `onboarding_invalid` (422): the step does not follow from the current phase, such as resuming before the answer is saved.

## Exit codes

| Exit | Meaning |
| --- | --- |
| 0 | Success. |
| 1 | The operation is not allowed in the current state, or something failed. |
| 2 | The input is wrong. |
| 3 | The task was not found. |
| 4 | The project was not found or the folder is not bound. |

Other web statuses: 400 for malformed JSON and 413 for a body over 1 MiB. Guards run before the target is looked up, so a refused request never reveals what exists.

Task mode (`wait --until task --idle-timeout <seconds>`) has a different successful ending: when no eligible task arrives before its idle deadline, it prints a `kind: "idle_timeout"` JSON result and exits 0. An eligible task also exits 0. Invalid arguments exit 2. A missing project exits 4. A stopped/mismatched server, invalid board data, or a stream failure returns `board_unavailable` and exits 1; these are errors, not idle completion. The idle timeout is 1 to 86,400 seconds and is required.
