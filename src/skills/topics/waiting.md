# Wait and resume

When no work can proceed in the ordinary work loop, wait for a change using the `cursor` of the latest snapshot of the same project. This wait can continue indefinitely; `--timeout` or Ctrl+C ends it without changing tasks or questions:

```sh
agboard --project "<name>" wait --after "<cursor>" --json
```

Never poll the board on a timer. `wait_timeout` (the end of an optional limit) and `board_unavailable` (a technical failure) are not answers. A waiting command starts the server itself; never start `agboard serve` first. `local_network_denied` means this environment does not allow local network connections: tell the user its reason (in Codex, `agboard setup` allows `agboard` outside the sandbox) and make no board-dependent changes until fixed. A question remains open until it is answered or withdrawn with `message withdraw <Q-id> --actor ai`. `cursor_invalid` and `project_not_found` are errors too: report them and make no board-dependent changes.

After `wait` or `message ask` returns, read the complete snapshot and history, including the user's reason and the answers printed by `message ask`. Reconsider the plan in light of the answer and update it if needed. Resume with a reason, which the state operation records:

```sh
agboard --project "<name>" state <id> running --actor ai --reason "<how the answer changes the work>"
```

If the answer changes the scope or completion conditions, update `TASK.md` (and `EPIC.md`) before resuming; if information still conflicts, ask again.

For an explicitly requested serial listener, use the listener procedure in `agboard skills listening` and `wait --until task --idle-timeout <seconds> --json`. It is distinct from waiting for a change or for answers with `message ask`; never start it implicitly.
