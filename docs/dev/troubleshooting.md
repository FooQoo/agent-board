# Troubleshooting

Find the symptom, read the cause, and do what the last column says. Error codes are listed in [Error codes](./reference/errors.md).

## Commands fail

| Symptom | Cause | What to do |
| --- | --- | --- |
| `database_busy` | Another command or the server held the project write lock for more than 5 seconds. | Run the command again. If it keeps happening, look for a stuck process holding the project. See [Saving and recovery](./concepts/saving-and-recovery.md#locks). |
| `task_is_draft` | The task is marked as a draft; agents may not change it. | Ask the person to finalize the draft in the web UI, and work on another task. Do not edit its `TASK.md`. |
| `task_is_done` | The task is Done; agents may not change it. | Ask the person to reopen it. |
| `acceptance_unmet` | An agent tried to move a task to Done while an acceptance condition is unmet or the frontmatter is invalid. | Verify the conditions and set `done: true` (the server then moves the task by itself), or fix the frontmatter. |
| `request_changed` | The question was answered, withdrawn by a move, or replaced. | Read the task again (`show`) and answer the current request. |
| `folder_unbound` or `bound_project_missing` | The working folder is not bound to a project, or the project was deleted. | Name the project explicitly with `--project`, or ask the user to bind the folder. |
| `confirmation_required` | A deletion needs a human y/N in a terminal. | Ask a person to run it. There is no option to skip the question. |

## The board shows something unexpected

| Symptom | Cause | What to do |
| --- | --- | --- |
| A task is missing from the board and `problems` lists its `task.json` | The file is malformed, has a `formatVersion` other than 1, or has unknown fields. | Read the `problems` entry: it names the file, field, and reason. Fix the file by hand; the product never repairs it. See [When files are invalid](./concepts/saving-and-recovery.md#when-files-are-invalid). |
| The body shows a warning and the conditions are empty | The frontmatter of `TASK.md` is not valid YAML. | Fix the frontmatter. The body is still shown meanwhile. |
| The page does not update after a CLI change | `serve` is not running, the notification was lost, or the shared area is on a network drive. | Reload the page. Changes are also detected from OS events, but network drives may not deliver them. See [Change notifications](./concepts/notifications.md). |
| A task stays Running after the agent crashed | Running is self-reported; nothing resets it. | Move the task or set its state yourself with `state`. |
| The board shows "Disconnected" | The SSE connection dropped. | The browser reconnects by itself and then reloads the board. |

## Servers and waiting

| Symptom | Cause | What to do |
| --- | --- | --- |
| `already_serving` | Another `serve` runs on the same data area. | Use that one, or stop it first. |
| `port_in_use` | Another program uses the port. | Pick another port with `--port`. Keep 7420 free for normal use; tests must use another port or port 0. |
| `board_unavailable` from `wait` or the hook | `serve` is not running, or the connection failed. It is a technical failure, not an answer. | Start `serve`, then run `wait` again. |
| `cursor_invalid` | The cursor is malformed or belongs to another project. | Take a fresh `cursor` from `snapshot` for the same project. |
| `wait_timeout` | The optional `--timeout` elapsed with no change. | Wait again. The question stays Pending. |

## Hooks

| Symptom | Cause | What to do |
| --- | --- | --- |
| `AGBOARD_ERROR` with `context_too_large` | The progress table exceeds 256 KiB or the input exceeds 64 KiB. | Make the table smaller (finish or split tasks). Do not make board-dependent changes until a table can be read. |
| `AGBOARD_ERROR` with `folder_unbound` | The folder is not bound. | Bind the folder to a project, or name the project explicitly. |
| The hook does not run | The hook is not registered, or `agboard` is not on `PATH`. | See [Integration setup](../guide/automation/agents.md#connect-your-agent) and check `command -v agboard`. |

## Building and testing

| Symptom | Cause | What to do |
| --- | --- | --- |
| `cargo build` stops with `Run "pnpm --dir web build" first.` | The Rust build embeds the web UI, which is not built. | Run `pnpm --dir web install` and `pnpm --dir web build`, then build again. |
| A change does not show up through a hook | Hooks run the installed `agboard`, not your working tree. | Reinstall with `cargo install --path . --locked --force`. See [Set up and run](./getting-started/setup.md#install-from-source). |
| A test failed on port 7420 or touched my board | A test used the default port or data area. | Tests must set `AGBOARD_HOME` to a temporary directory and use an available port or port 0. |
| Times in a test differ by machine | The time zone is not fixed. | Run tests with `TZ=UTC`. |
| `pnpm --dir docs build` reports a dead link | A page moved or a heading changed. | Fix the link; the build fails on dead links by design. |
