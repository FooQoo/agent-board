# Troubleshooting

Find the symptom, read the cause, and do what the last column says. Error codes are listed in [Error codes](./reference/errors.md).

## Commands fail

| Symptom | Cause | What to do |
| --- | --- | --- |
| `database_busy` | Another command or the server held the project write lock for more than 5 seconds. | Run the command again. If it keeps happening, look for a stuck process holding the project. See [Saving and recovery](./concepts/saving-and-recovery.md#locks). |
| `task_is_draft` | The task is a draft: agents may not change a person's draft, and may not move or run any draft. | Ask the person to finalize the draft in the web UI, and work on another task. Do not edit its `TASK.md`. |
| `epic_is_draft` | The epic is marked as a draft; the CLI may not edit its details or task order. | Wait for the person to save or discard the draft, or ask them to finalize it. `epic attachment` and membership changes still work. Do not edit its `EPIC.md`. |
| `task_is_done` | The task is Done; agents may not change it. | Ask the person to reopen it. |
| `acceptance_unmet` | An agent tried to move a task to Done while an acceptance condition is unmet or the frontmatter is invalid. | Verify the conditions and set `done: true` (the server then moves the task by itself), or fix the frontmatter. |
| `questions_unanswered` | An agent tried to set a task to Running, or move it to Done, while it waits for a person. | Wait for the answers with `message wait <question-id>`, or ask the person to answer on the board. |
| `question_answered` or `question_withdrawn` | The question already has an answer, or it was withdrawn. The first answer is final. | Read the question again (`message show <question-id>`) and use the recorded answer. |
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
| `already_serving` | Another `serve` runs on the same data area. | Use that one, or stop it first. If it was started automatically, `agboard serve -d` keeps it running. |
| `port_in_use` | The port given to `serve` is taken; the reason says whether another Agent Board server or another program holds it. | Pick another port with `--port`. Keep 7420 free for normal use; tests must use another port or port 0. |
| `local_network_denied` | The OS or a sandbox does not let `agboard` use `127.0.0.1`. | In Codex, run `agboard setup`. Elsewhere, run the command outside the sandbox. |
| `board_unavailable` from `wait`, `message ask`, `message wait`, or the hook | Autostart is off, the server could not start, the server in `serve.json` does not answer, or the connection failed. It is a technical failure, not an answer. | Read the reason. When it names `serve.log`, read that file. When it names a pid, run `agboard stop`. Then run `wait` again. For questions already saved, run `message wait <question-id>`. |
| A test starts a server on 7420 | The test runs `agboard` without `AGBOARD_AUTOSTART=0`. | Set `AGBOARD_AUTOSTART=0`, or `AGBOARD_AUTOSTART_PORT=0` in a test of autostart itself. |
| A test opens a browser window | The test runs `agboard` with autostart on and without `AGBOARD_OPEN_BROWSER=0`. | Set `AGBOARD_OPEN_BROWSER=0`. A test of opening sets `AGBOARD_BROWSER_OPENER` to a script that records the address instead. |
| An automatic server did not open the board | A board page connected within the grace period, or opening is off. | Read `serve.log`: it says `Opened …`, `Did not open …` with the reason, or `Could not open …`. See [Opening the board](./concepts/server-and-ui.md#opening-the-board). |
| `cursor_invalid` | The cursor is malformed or belongs to another project. | Take a fresh `cursor` from `snapshot` for the same project. |
| `wait_timeout` | The optional `--timeout` of `wait --after` elapsed with no change. | Wait again. |
| `message ask` or `message wait` exits 5 | The `--timeout` passed before every question was answered. The questions stay open. | Run `message wait <question-id>` again. |

## Hooks

| Symptom | Cause | What to do |
| --- | --- | --- |
| `AGBOARD_ERROR` with `context_too_large` | The progress table exceeds 256 KiB. | Make the table smaller (finish or split tasks). Do not make board-dependent changes until a table can be read. |
| `AGBOARD_ERROR` with `folder_unbound` | The folder is not bound. | Bind the folder to a project, or name the project explicitly. |
| The hook does not run | The hook is not registered, or `agboard` is not on `PATH`. | See [Set up your agents](../guide/delegate/agents.md#set-up-your-agents) and check `command -v agboard`. |

## Building and testing

| Symptom | Cause | What to do |
| --- | --- | --- |
| `cargo build` stops with `Run "pnpm --dir web build" first.` | The Rust build embeds the web UI, which is not built. | Run `pnpm --dir web install` and `pnpm --dir web build`, then build again. |
| A change does not show up through a hook | Hooks run the installed `agboard`, not your working tree. | Reinstall with `cargo install --path . --locked --force`. See [Set up and run](./getting-started/setup.md#install-from-source). |
| A test failed on port 7420 or touched my board | A test used the default port or data area. | Tests must set `AGBOARD_HOME` to a temporary directory and use an available port or port 0. |
| Times in a test differ by machine | The time zone is not fixed. | Run tests with `TZ=UTC`. |
| `pnpm --dir docs build` reports a dead link | A page moved or a heading changed. | Fix the link; the build fails on dead links by design. |
