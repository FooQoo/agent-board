---
title: Resident session
---

# Resident session

A resident session is an agent session that Agent Board starts for you and keeps attached to the board. It waits for your requests and for the answers to its questions, so you do not have to start an agent in a terminal first. You start and stop it from **Settings**.

::: warning It runs unattended with automatic approval
A session the board starts runs without a person watching it, and it approves the actions it takes by itself. Start it only for projects you trust. It works in the folder bound to the project and can change files there.
:::

## Start and stop it {#start-and-stop}

1. Open **Settings** and choose **Resident session settings**. The row shows a one-line summary, such as `Claude Code · working` or `Not running`, and `· External 1` when a session you started yourself is also attached.
2. Under **Tool**, choose **Claude Code** or **Codex**. The board starts one session in total, so a running session has to stop before the other tool can start.
3. Under **Model**, keep **Default model** or choose one from the list. If the list cannot be read, the dialog says why and offers only the default.
4. Choose **Start**. While the request runs, the controls are disabled and the button reads **Starting…**. Choose **Stop** to end the session, or **Restart** after a failure.

The tool and model you choose apply from the next start. While a session runs with another choice, the dialog shows `Next start: …`.

If the tool is not installed or not logged in, the card says so with the reason and the command to run in a terminal. Choose **Check again** after you fix it. A project without a bound folder cannot start a session; bind one with `agboard project bind`.

## Start automatically {#start-automatically}

Turn on **Start automatically when Agent Board starts** to start the session each time the board starts. The board remembers one choice in total: the tool, the model, and the project you had open. Turning it off does not stop a running session.

## States {#states}

| State | Meaning |
| --- | --- |
| **Working on a task** | The session runs and is not waiting on the board, because it is busy with a task. |
| **Waiting** | The session runs and waits for a request or an answer. |
| **Restarting** | The session ended and the board starts it again. The dialog shows the next try and how many times it restarted. |
| **Stopped** | Nothing is running. |
| **Failed** | The board gave up, for example after the session ended repeatedly in a short time. The reason is shown. Fix the cause, then choose **Restart**. |

The dialog also counts the sessions attached to the board, split into those the board started and **External sessions** you started yourself. The footer of the board shows the tool and a dot while a session is launched or auto-start is on; click it to open the dialog.

## Remote access {#remote-access}

Starting, stopping, and the auto-start choice are available only on the PC. Through [remote access](../watch/remote-access) the footer indicator is display-only. The phone layout, which has no footer, does not show it.
