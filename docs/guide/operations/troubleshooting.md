---
title: Troubleshooting
---

# Troubleshooting

Find what you see, read the cause, and do what the last column says. The commands show errors as a short code such as `task_is_draft`; the meaning of every code is in the [developer guide](../../dev/reference/errors).

## The board does not show what I expect

| What you see | Cause | What to do |
| --- | --- | --- |
| A task is missing from the board | Its file is damaged, or it has an unsupported `formatVersion`. | Open `agboard --project "My project" snapshot --json` and read `problems`: it names the file, the item, and the reason. Fix the file by hand; Agent Board never rewrites it. See [When a file is invalid](../automation/file-format#when-a-file-is-invalid). |
| A task shows a warning and no conditions | The frontmatter of its `TASK.md` is not valid YAML. | Fix the frontmatter. The body stays visible meanwhile. |
| The board does not update after an agent changed something | The server is not running, or the files are on a network drive. | Reload the page. Keep `agboard serve` running. Network drives may not report file changes. |
| The board says it is disconnected | The connection to the local server dropped. | Wait a moment; the page reconnects by itself and reloads the board. If the server stopped, start it again. |
| A task stays **Running** after the agent stopped | Running is what the agent last reported; it is not a live check. | Move the task, or ask the agent to report a new state. |
| A question disappeared | Moving the task to another column withdraws an open question, or the agent asked a new one. | Open the task's History tab, and answer the current question if there is one. |

## An agent cannot do something

| Error | Cause | What to do |
| --- | --- | --- |
| `task_is_draft` | The task is a draft; agents may not change it. | Finalize the draft in the browser. The agent can work on other tasks meanwhile. |
| `task_is_done` | The task is Done; agents may not change it. | Reopen the task in the browser if more work is needed. |
| `acceptance_unmet` | The agent tried to move a task to Done while a condition is unmet. | Have the agent verify the conditions and mark them done; the task then finishes by itself. |
| `request_changed` | The question was already answered, withdrawn, or replaced. | Read the task again and answer the current question. |
| `folder_unbound` or `bound_project_missing` | The agent's folder is not registered to a project, or the project was deleted. | Register the folder: `agboard project bind "My project"`. See [Data and backups](./data#register-a-folder). |
| `confirmation_required` | Deleting something needs a person's confirmation in a terminal. | Run the command yourself. |
| The hook shows `AGBOARD_ERROR` | The progress table cannot be built (no project, table larger than 256 KiB, or the server is unreachable). | Fix the cause named in the message. The agent must not change the board until the table works. |

## The server will not start

| Error | Cause | What to do |
| --- | --- | --- |
| `already_serving` | Another server already runs on this data folder. | Use that one, or stop it with Ctrl+C in its terminal first. |
| `port_in_use` | Another program uses the port. | Choose another one: `agboard serve --port 7421`. |
| `database_busy` | Another command held the project for more than 5 seconds. | Run the command again. |

## The phone cannot reach the board

| What you see | Cause | What to do |
| --- | --- | --- |
| The page does not load | The server or the ngrok connection is not running, or the computer is asleep. | Start the server and the connection again and keep the computer awake. |
| The phone shows **Enter the passcode** again, or says the connection is stopped | The session ended (a connection lasts up to 12 hours), or the connection was stopped and started again, which makes a new passcode. | Type the passcode now shown on the PC (in **Settings** → **Mobile connection**, or on the `serve` startup line). If the connection is stopped, start it again there. |
| The phone says **Too many wrong passcodes** | 5 wrong passcodes were entered in a row, so the monitor stopped accepting any, even the right one. | On the PC, choose **Stop** and connect again (or restart `serve`). The new passcode starts with a fresh count. |
| The phone says the passcode was not accepted | The digits do not match the passcode of the current connection. The passcode changes whenever the connection starts. | Read the passcode on the PC again. A passcode from an earlier start does not work. |
| The dialog says the settings were saved but ngrok could not be reached | The ngrok authtoken is wrong, or there is no internet connection. | Check the token and the connection, then choose **Save and try again**. |
| The page loads but answers are refused | The address you opened is not the public address of the current connection. | Open the address the connection reports. Restarting the connection issues a new session. |
| The monitor says the data is out of date | Auto-update stopped, or some projects could not be read. | Reload or reopen the page. The monitor re-fetches when it becomes visible again. |

## Still stuck?

- Read `problems` in `snapshot --json`: it explains file and format errors.
- Check which data folder you use: the CLI, the server, and the hooks must share the same `AGBOARD_HOME`. See [Data and backups](./data#where-the-data-lives).
- If you work on Agent Board itself, the [developer troubleshooting page](../../dev/troubleshooting) covers building, testing, and internal failures.
