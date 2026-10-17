# Follow your first change

This tutorial traces one existing rule through the code, from the command to the file to its test, so that you learn where things are before you change something. The rule: **an AI agent cannot move a task to Done while an acceptance condition is unmet.**

You need a working build. If you have not built Agent Board yet, start with [Set up and run](./setup.md).

## 1. See the rule in action

Use a temporary board so that your own board is untouched:

```sh
export AGBOARD_HOME="$(mktemp -d)"
cargo run -- project create demo
cat > /tmp/demo-task.md <<'EOF'
---
acceptance:
  - id: AC-1
    text: The list is returned as JSON.
    done: false
history: []
---

Return the list as JSON.
EOF
cargo run -- --project demo add "List as JSON" --assignee ai --actor ai --desc-file /tmp/demo-task.md
cargo run -- --project demo mv 1 doing --actor ai
cargo run -- --project demo mv 1 done --actor ai
```

The last command fails with `acceptance_unmet` and names the unmet condition. Run it again with `--actor human` and it succeeds: the rule restrains agents, not people.

## 2. Find the command

Every command lives in `src/cli/commands/`. Open `mv.rs`. It resolves the project, builds a `ChangeContext` (the actor and the reason), and calls `files.move_work_task(...)`. It does no checking of its own. The rules live below the CLI so that the web server and the CLI share them.

## 3. Find the rule

`move_work_task` is in `src/file_store/ops/agent.rs`. Read the function in order:

1. It takes the project write lock (`lock_project`), because everything after this point must see the latest files.
2. It reads the task strictly (`read_task_strict`); a task with a defective file is refused here.
3. It refuses archived tasks and Done tasks for AI actors.
4. **This is the rule**: when the actor is `Ai`, the target is `Done`, and the task is not Done yet, it calls `ensure_acceptance_met`. That function returns `AcceptanceUnmet` with the unmet conditions.
5. Only then does it build the history entry, update the fields, and call `save_task`, which commits `task.json` and `TASK.md` as one pair (see [Saving and recovery](../concepts/saving-and-recovery.md)).

Notice what is *not* here: no printing and no JSON. The error carries a code (`acceptance_unmet`), and `src/error.rs` turns it into the message, the exit code, and the HTTP status. See [Error codes](../reference/errors.md).

## 4. Find the test

The CLI behavior is tested in `tests/acceptance_cli.rs`. Find `an_agent_cannot_move_a_task_to_done_while_a_condition_is_unmet`. Tests run the real binary against a temporary `AGBOARD_HOME`, which is why they never touch your board.

Run just that file:

```sh
TZ=UTC cargo test --test acceptance_cli
```

## 5. Change the rule, test first

Suppose a person also had to confirm Done when conditions are unmet. A real change would follow this order:

1. Write a failing test in `tests/acceptance_cli.rs` (copy the test for a person moving a task and change its expectation).
2. Change the condition in `move_work_task`. Because the web server calls the same function, one change covers both entry points.
3. Run `TZ=UTC cargo test --test acceptance_cli`, then the whole suite.
4. Update the page that describes the rule. This one is in [History and decisions](../concepts/history-and-decisions.md#acceptance-conditions-and-automatic-done), and its Japanese translation in `docs/ja/dev/`.

You do not need to make this change; the point is the path: **command → shared rule in `file_store` → error code → test → documentation.** Almost every change in Agent Board follows it.

## Where to go next

- [Tasks and states](../concepts/tasks-and-states.md) for the model behind the rule.
- [Verify and open a pull request](./pull-request.md) for the checks to run before you finish.
