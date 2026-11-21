# Plan a request: the Backlog, questions, then a person sends it

When a request, or a user's chat message, asks for more than one task, such as a feature, a change across several areas, or a list of things to do, decide what it asks for. If it asks for the plan only, put the plan in the Backlog and let the person see and correct it. If it asks you to carry out the work, create ordinary Todo tasks. If it is unclear which of the two the request asks for, ask with `message ask` (`agboard skills questions`) before you create anything: a plan made in the wrong lane either starts work nobody asked for or leaves requested work waiting. The question's answer is on the board, so the same answer holds after a resident restart and in another session.

| The request says | Place the tasks |
| --- | --- |
| "Make a plan for X", "break X down", "I want to review the plan first" | Backlog (`add --backlog`) |
| "Do X", "implement X", "fix X and open a PR" | Todo (`add` without `--backlog`) |
| "Look into X", "handle X", "X please" with nothing about plan or work | Ask first with choices "Plan only (Backlog)" and "Plan and carry it out (Todo)", recommending the one the context favors |

Only Todo tasks that are ready are delivered to you: AI-owned, idle, not waiting on a question, and not held back by an earlier wave. Questions on Backlog tasks are answered and the plan is revised, but the tasks stay in the Backlog until a person sends them.

1. **Read.** Read the progress table and the relevant epics and tasks, so the plan reuses what exists and creates no duplicates.
2. **Place the plan.** Create the epic (or use an existing one) and write its `EPIC.md`: goal, scope, completion conditions, and the tasks in work order with their dependencies. `epic add` has no lane. For a plan only, create each task in the Backlog with `--backlog`, in that order, each with its owner (`ai` or `human`), plan, and acceptance conditions; keep each to one piece of work that can be reviewed on its own. Document updates the work needs belong in a task's acceptance conditions.

   ```sh
   agboard --project "<name>" add "Plan the work" --assignee ai --actor ai --backlog --epic <EPIC-ID>
   ```

   A Backlog task means "do not start": agents never start it. For a request to carry out the work, create the tasks without `--backlog`; they are ordinary Todo tasks, and open questions make them pending as usual.
3. **Ask what you cannot settle.** Ask in one `message ask` call (`agboard skills questions`), with choices and a recommendation where you can, and wait for the answers. List the tasks the answer would change in `tasks` (`--task` or the per-question `tasks`). A question can have no choices and be answered in words. When a question asks the user to judge something visual (a mock, a screenshot, a layout), attach the images to the question with `images` and show them in its `body` as `![description](attachments/<file name>)`; never send only a local link, because the user may be on a phone where it does not open.
4. **Revise.** You may `edit` a Backlog task and `history add` to it. Write the answers into the epic and the tasks, and record what changed. If the answers leave something open, ask again the same way.
5. **Leave the sending to the person.** For a Backlog plan only: only a person sends a Backlog task to Todo (`send`, `epic send`). `send` and `epic send` fail for an agent with `human_only`, and `mv` and `state` on a Backlog task fail with `task_in_backlog`. Do not try them. Work on other tasks while the plan waits. For a request to carry out the work there is nothing to send: the tasks are Todo already, so go to step 6.
6. **Proceed.** For a Backlog plan, after a person sends the tasks, they are ordinary Todo tasks; for an execute request they were Todo from the start. Work through the epic's tasks in its order (section 6) without asking again, except in the four cases of section 7.

After the send (or, for an execute request, once the tasks exist), the board cannot stop you from rewriting a started task's contents. Keep to the plan that was sent: if the work needs a different scope, ask (`agboard skills questions`) instead of changing the tasks silently.

A task the user already put on the board needs no send to work on. Splitting an oversized task plan (section 3) is asked with a question on that task.
