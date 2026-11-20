---
name: remote
description: Give the user the Agent Board phone remote-access URL and passcode in one step. Use when the user asks for the remote access URL, the phone link, the passcode, or wants to open the board on their phone, for example "remote access URL", "phone link", "リモートアクセスのURL", "スマホで開きたい".
compatibility: Requires the agboard CLI on PATH and a running Agent Board server whose ngrok connection is ready.
---

# Agent Board remote access

Hand the user the address and passcode that open the board on their phone. This skill only reads the state of a connection that already exists. It never starts the server or ngrok.

## Steps

1. Find the project of the current folder. `agboard show remote` needs `--project` to give an address, so read the name from the progress table:

   ```sh
   agboard progress --json
   ```

   Use `project.name`. If the user named a project, use that name instead. If the folder is not bound (`folder_unbound`), ask which project to use, or show the user `agboard project bind "<name>"` to run in their own terminal. Do not create or bind a project yourself.

2. Run:

   ```sh
   agboard --project "<name>" show remote --json
   ```

3. When `status` is `ready`, reply with the `url` and the `passcode` from the JSON, as is. Add one short warning: anyone who can read this chat can open the board while the connection is up, so stop the connection when done (from the board's Settings, or `agboard stop`).

## When it is not ready

`show remote` prints no address and no passcode and exits with code 1 (`remote_unavailable`) when there is nothing to hand out. Relay the reason in one or two sentences and give the matching next step:

- No server is running, or the connection is not `ready` (for example it is still starting, or its status shows a failure): ask the user to turn the connection on from the board's **Settings**, or to run `agboard serve --monitor ngrok` in their own terminal with `NGROK_AUTHTOKEN` already set in the environment. Then offer to run this skill again.
- Ready but no public address or passcode yet: ask the user to wait a moment and try again, or restart the connection.
- Exit code 4: the project does not exist. Check the name with `agboard project ls --json`.
- Exit code 2 (`invalid_argument`): the `--project` value was missing. Add it.

Never ask for, print, or store the ngrok token. Never start `agboard serve`, `agboard serve -d`, or ngrok yourself, and never run `agboard stop` unless the user asks you to. Do not write the passcode to a file or the board.

Answer in the language the user speaks with you.
