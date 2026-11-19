---
title: Troubleshooting
---

# Troubleshooting

Find what you see, read the cause, and do what the last column says. The commands show errors as a short code such as `task_is_draft`; the meaning of every code is in the [developer guide](../../dev/reference/errors).

## The board does not show what I expect

| What you see | Cause | What to do |
| --- | --- | --- |
| A task is missing from the board | Its file is damaged, or it has an unsupported `formatVersion`. | Open `agboard --project "My project" snapshot --json` and read `problems`: it names the file, the item, and the reason. Fix the file by hand; Agent Board never rewrites it. See [When a file is invalid](../reference/file-format#when-a-file-is-invalid). |
| A task shows a warning and no conditions | The frontmatter of its `TASK.md` is not valid YAML. | Fix the frontmatter. The body stays visible meanwhile. |
| The board does not update after an agent changed something | The server is not running, or the files are on a network drive. | Reload the page. The server starts when an agent waits or its hook runs, or start it with `agboard serve -d`. Network drives may not report file changes. |
| The board opened in the browser by itself | An agent's command or hook started the server in the background, and no board tab was connected. It opens once for each start. | Keep the tab open, or set `AGBOARD_OPEN_BROWSER=0` to turn this off. See [Open the board in the browser](../reference/cli#open-the-board-in-the-browser). |
| The board did not open when the server started | A board tab connected first, `AGBOARD_OPEN_BROWSER=0` is set, the command ran over SSH, or Linux has no display. `serve.log` in the data folder says which. | Run `agboard open`, or open the address that `agboard open --print` shows. |
| The board says it is disconnected | The connection to the local server dropped. | Wait a moment; the page reconnects by itself and reloads the board. If the server stopped, start it again. |
| A task stays **Running** after the agent stopped | Running is what the agent last reported; it is not a live check. | Move the task, or ask the agent to report a new state. |
| A question disappeared | It was answered elsewhere, for example in the chat, or the agent withdrew it. Moving a task does not withdraw its questions. | Open the task's History tab, or run `agboard message ls --status all`, and answer the current question if there is one. |
| A task or epic stays **Draft** after I closed its preview | A window closed with unsaved changes leaves the draft behind, and it stays until someone finalizes it. | Open the task's or epic's details and choose **Finalize**. Saving or discarding in a new preview keeps the draft. |

## An agent cannot do something

| Error | Cause | What to do |
| --- | --- | --- |
| `task_is_draft` | The task is a draft; agents may not change a person's draft, or move or run any draft. | Finalize the draft in the browser, or start an AI draft with `agboard start`. The agent can work on other tasks meanwhile. |
| `ai_draft_needs_start` | A finalize was asked of an AI draft. | Start it instead: `agboard start <id>` or `agboard epic start <EPIC-ID>`. |
| `human_only` | An agent tried to withdraw a request. | A person withdraws a request. |
| `epic_is_draft` | The epic is a draft; agents may not change its details or task order. | Wait for the person to save or discard the epic's draft, or ask them to finalize it. Attachments and task membership still work. |
| `task_is_done` | The task is Done; agents may not change it. | Reopen the task in the browser if more work is needed. |
| `acceptance_unmet` | The agent tried to move a task to Done while a condition is unmet. | Have the agent verify the conditions and mark them done; the task then finishes by itself. |
| `question_answered` or `question_withdrawn` | The question was already answered, or it was withdrawn. The first recorded answer is kept. | Read the question again with `agboard message show`, and answer the current question if there is one. |
| `start_blocked_by_questions` | The task, or a task of the epic, has a question that nobody has answered, so it cannot start yet. | Answer the questions the message names (on the board or with `agboard message answer`), then start again. |
| `request_accepted`, `answer_accepted`, `question_open`, `request_withdrawn`, or `message_closed` | The request was already accepted or withdrawn, the answer was already taken in, the question has no answer yet, or the message already has its answer or acceptance and cannot be withdrawn. | Read the message with `agboard message show`; nothing more is needed. |
| `ai_only`, `message_type_mismatch`, or `choice_unknown` | A person tried to withdraw a question, the command does not fit the kind of message (for example, answering a request), or the choice is not one of the question's options. | Use the command for that kind of message, and a choice shown by `message show`. |
| `questions_unanswered` | The task waits for an answer, so the agent cannot set it to Running or move it to Done. | Answer the question on the board, or have the agent withdraw it. |
| `folder_unbound` or `bound_project_missing` | The agent's folder is not registered to a project, or the project was deleted. (The hook itself stays silent in a folder with no binding; this error comes from `agboard progress` and from a deleted project.) | Register the folder: `agboard project bind "My project"`. See [Data and backups](./data#register-a-folder). |
| `confirmation_required` | Deleting something needs a person's confirmation in a terminal. | Run the command yourself. |
| The hook shows `AGBOARD_ERROR` | The progress table cannot be built (no project, table larger than 256 KiB, or the server is unreachable). | Fix the cause named in the message. The agent must not change the board until the table works. |

## The server will not start

| Error | Cause | What to do |
| --- | --- | --- |
| `already_serving` | Another server already runs on this data folder. | Use that one, or stop it first with `agboard stop`. If a command started it, `agboard serve -d` keeps it running. Otherwise, in a terminal, `agboard serve -d` offers to replace it. |
| `port_in_use` | The port you gave `agboard serve` is taken. The message says whether another Agent Board server (with a different data folder) or another program uses it. | Choose another one: `agboard serve --port 7421`. |
| `local_network_denied` | The environment does not let `agboard` use local network connections, so the server cannot start or be reached. | In Codex, run `agboard setup` to allow `agboard` to run outside the sandbox. |
| `database_busy` | Another command held the project for more than 5 seconds. | Run the command again. |
| `browser_open_failed` | `agboard open` could not start the program that opens the browser (`open`, `xdg-open`, or `AGBOARD_BROWSER_OPENER`). | Open the address in the message yourself, or install or fix that program. |

## The phone cannot reach the board

| What you see | Cause | What to do |
| --- | --- | --- |
| The page does not load | The server or the ngrok connection is not running, or the computer is asleep. | Start the server and the connection again and keep the computer awake. |
| The phone shows **Enter the passcode** again, or says the connection is stopped | The session ended (a connection lasts up to 12 hours), or the connection was stopped and started again, which makes a new passcode. | Type the passcode now shown on the PC (in **Settings** → **Remote connection**, or on the `serve` startup line). If the connection is stopped, start it again there. |
| The phone says **Too many wrong passcodes** | 5 wrong passcodes were entered in a row, so the monitor stopped accepting any, even the right one. | On the PC, choose **Pause connection** and then **Resume** (or restart `serve`). The new passcode starts with a fresh count. |
| The phone says the passcode was not accepted | The digits do not match the passcode of the current connection. The passcode changes whenever the connection starts. | Read the passcode on the PC again. A passcode from an earlier start does not work. |
| The dialog says the settings were saved but ngrok could not be reached | The ngrok authtoken is wrong, or there is no internet connection. | Check the token and the internet connection, then choose **Save and connect** again. |
| The page loads but answers are refused | The address you opened is not the public address of the current connection. | Open the address the connection reports. Restarting the connection issues a new session. |
| The monitor says the data is out of date | Auto-update stopped, or some projects could not be read. | Reload or reopen the page. The monitor re-fetches when it becomes visible again. |

## setup or update reports a problem {#setup-or-update-reports-a-problem}

| What you see | Cause | What to do |
| --- | --- | --- |
| `setup asks which agent to set up and needs a terminal` or `asks for a confirmation and needs a terminal` (exit 2) | The command was started from a pipe, a script, or an agent, or with `--json`, without the options that replace the questions. | Run it yourself in a terminal, or add `--agent` and `--yes` (or `--dry-run`). |
| `The codex command was not found on PATH` (or `claude`), and the agent is `skipped` | The agent is not installed, or its command is not on your `PATH`. | Install it or fix `PATH`, then run the command again. |
| `The Agent Board plugin is not installed` from `update` | `update` only moves a plugin that is installed. | Run `agboard setup` for that agent. |
| An agent is `failed` with `codex plugin …` or `claude plugin …` in the reason | The agent's own plugin command failed, for example without a network connection to GitHub. The message ends with that command's output. | Fix the cause and run the command again. The settings files already written stay correct. |
| A manual step about `sandbox_mode` or a permission profile | Codex's permission settings do not let the data folder be written, and setup never changes them. | Set `sandbox_mode = "workspace-write"` in Codex's `config.toml` yourself, or add the data folder to your permission profile, then run `agboard setup` again. |
| `Codex lists no hooks of the Agent Board plugin` or `still does not trust the hook` | The plugin is not enabled in Codex, or Codex refused the trust. | Check the plugin with `codex plugin list`, then review the hooks with `/hooks` in Codex. |
| The agent does not run the Hook | The agent was not restarted, or the Claude Code Hook is not reviewed. | Start a new session (Claude Code) or restart Codex, then review the Hook with `/hooks`. |
| A new session says the plugin is being updated, or that the automatic update did not complete | `agboard` was upgraded and the Hook found a different plugin. The update runs in the background; it did not finish, or Codex needs its hooks trusted. | Start a new session to use the update. If it did not complete or you use Codex, run `agboard update`, then start a new session. |

Exit codes of both commands are in the [CLI reference](../reference/cli#setup-and-update).

## macOS will not run agboard

The command from Homebrew is signed with a Developer ID certificate and notarized by Apple. If macOS blocks it, do not turn off Gatekeeper or remove the quarantine yourself. First check that `brew install fooqoo/tap/agboard` finished without an error, that your Mac runs macOS 15 or later, and that `agboard --version` runs. The first launch may need a network connection so that macOS can check the notarization. If it is still blocked, [open an issue](https://github.com/FooQoo/agent-board/issues) with the macOS version and the message.

## Still stuck?

- Read `problems` in `snapshot --json`: it explains file and format errors.
- Check which data folder you use: the CLI, the server, and the hooks must share the same `AGBOARD_HOME`. See [Data and backups](./data#where-the-data-lives).
- If you work on Agent Board itself, the [developer troubleshooting page](../../dev/troubleshooting) covers building, testing, and internal failures.
