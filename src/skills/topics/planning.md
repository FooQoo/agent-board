# Plan a request: AI drafts, questions, then start them yourself

When a request, or a user's chat message, asks for more than one task, such as a feature, a change across several areas, or a list of things to do, put a plan on the board as AI drafts and let the person see and correct it. Do not ask before registering it: reacting to a plan is easier than describing one.

1. **Read.** Read the progress table and the relevant epics and tasks, so the plan reuses what exists and creates no duplicates.
2. **Place the plan.** Create the epic (or use an existing one) and write its `EPIC.md`: goal, scope, completion conditions, and the tasks in work order with their dependencies. Create the tasks in that order, each with its owner (`ai` or `human`), plan, and acceptance conditions; keep each to one piece of work that can be reviewed on its own. Document updates the work needs belong in a task's acceptance conditions. Everything you create this way is an AI draft (`draft: ai`), the user's tasks too. The board shows the epic's drafts as one proposed plan.
3. **Ask what you cannot settle.** Ask in one `message ask` call (section 7), with choices and a recommendation where you can, and wait for the answers. List the draft tasks the answer would change in `tasks` (`--task` or the per-question `tasks`). A draft that refers to a question without an answer cannot be started: `start` and `epic start` fail with `start_blocked_by_questions`. A question can have no choices and be answered in words. When a question asks the user to judge something visual (a mock, a screenshot, a layout), attach the images to the question with `images` and show them in its `body` as `![description](attachments/<file name>)`; never send only a local link, because the user may be on a phone where it does not open.
4. **Revise.** You may `edit` a draft and `history add` to it. Write the answers into the epic and the tasks, and record what changed. If the answers leave something open, ask again the same way.
5. **Start the drafts.** When every question is answered and the plan is written up, start them yourself:

   ```sh
   agboard --project "<name>" start <ID> --actor ai
   agboard --project "<name>" epic start <EPIC-ID> --actor ai
   ```

   `mv` and `state` on a draft are refused with `task_is_draft` until then. A person may also start drafts. Tasks a person is still drafting (`draft: human`) stay drafts. Work on other tasks while questions are open.
6. **Proceed.** After the start, the tasks are ordinary tasks. Work through the epic's tasks in its order (section 6) without asking again, except in the four cases of section 7.

After the start, the board cannot stop you from rewriting a started task's contents. Keep to the plan you started: if the work needs a different scope, ask (section 7) instead of changing the tasks silently.

A task the user already put on the board needs no start to work on. Splitting an oversized task plan (section 3) is asked with a question on that task. A task you add to an epic that is already running is a draft too: start it with `start <ID> --actor ai`.
