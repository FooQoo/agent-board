# Release notes

What changed in each published version of Agent Board, newest first. Each version also has a [GitHub Release](https://github.com/FooQoo/agent-board/releases) with its downloads.

## v1.6.0

A release that brings the results of the work to your phone: agents deliver results you can look at while they keep working, the board notifies an iPhone, and the phone board gets a bottom bar, an archive list, and a redesigned layout.

### Changes

- **Agents deliver results.** An agent records the first thing you can look at, such as a draft video or UI captures, with `agboard result add` and keeps working without waiting for a reply. A result has a title, a short summary, up to 20 images, and a link or storage location of the main artifact, and it is marked in progress or final. A result needs no reply; a choice you must make is still asked as a question. `agboard result ls` lists a task's results. An agent that finishes a task without a final result is reminded to record one.
- **Read results on the board.** Task details have a new **Results** tab on the PC and the phone. It lists results newest first with a badge, version, time, title, summary, and images you can enlarge and swipe through. A web link opens in a new tab; any other value is shown as text. A result can also be opened from an address that names the project, the task, and the version.
- **Notifications on an iPhone.** Add the board to the Home Screen, open it from the icon, and choose **Enable notifications**. No other app or account is needed, and notifications are encrypted from your PC to the phone. **Notification settings** in **Settings** switches results, questions that need your decision, and history additions one by one. Each notification shows the card's title with one short line, and tapping it opens the result, the question, or the card.
- **Summaries of results.** The board records a summary of the results of each period (every 30 minutes, 1, 2, or 4 hours, or off; every hour at first). A new **Summary** tab in **Questions & requests** lists them; delete one with the trash button or a swipe. The summary notification opens that tab.
- **Your phone is remembered.** Entering the passcode registers the phone, so it opens the board again without the passcode after the 12-hour session ends, after a pause and resume, or after the PC restarts. The connection dialog lists **Registered phones**, and **Remove** signs a phone out at once. **Stop connection** is now **Pause connection**, which keeps the token and the registered phones.
- **Keep the same address.** Enter a domain your ngrok account owns (the **ngrok domain** field or `AGBOARD_NGROK_DOMAIN`), and the address stays the same after every start, so bookmarks and Home Screen icons keep working.
- **Set up remote access from the command line.** `agboard setup remote` saves the domain, the token, and whether the connection is on; plain `agboard setup` offers it on a terminal. `agboard show remote` shows the saved settings and the connection state, and with `--project` prints the phone address and passcode.
- **A new phone layout.** A bottom bar with **Board**, **Messages**, **Ask**, **Archive**, and **Settings** replaces the messages band. Messages shows the number of open questions. Drawers slide up over the board, and the bar stays in front of them. Pull a lane down to refresh it. The Home Screen app and the header keep clear of the status bar, the Dynamic Island, and the home indicator, and a tablet keyboard no longer hides the field you type in.
- **Review and restore archived tasks on the phone.** **Archive** in the bottom bar opens the archived tasks, newest first, as the same cards as the lanes, each with the lane it returns to and the day it was archived. Swipe a card to the left to restore it to the lane it came from; with a keyboard, focus the card and press Enter. To archive every Done card, swipe past the Done lane to the left, or use **Archive all** below its cards.
- **Faster moves.** Dragging a card to another lane, or moving it with a lane button on the phone, now moves it at once with no confirmation. If the card was moved meanwhile, nothing changes and a notice names its lane.
- **Answer with pictures.** Add images to an answer (picked or pasted, up to 20 images and 50 MiB) and they are handed to the agent with the answer. Agents can also attach images to a question with `message ask`. On the phone the picked images are large enough to tap, and a tap enlarges them. Enlarged images can be swiped through, and a single tap on **Send request** or **Send answer** sends while the keyboard is open.
- **Order epics in waves.** An epic's tasks now run in waves: tasks of one wave can run in parallel, and a wave starts when every task of the earlier waves is Done. Edit the waves by dragging in the epic's progress panel or with `agboard epic edit --waves`. The next-task list, `agboard wait`, and the resident agent hold back tasks of later waves.
- **A turn-end checklist for agents.** When a Claude Code or Codex agent ends a turn, the hook reminds it once about a question it asked only in the chat, or a result it did not record. The agent instructions are also split into short topics, and agents keep replying in the language you chose in the settings.
- **A clearer resident agent.** The **Resident session** is now the **Resident agent**, with a log pane in its dialog, history of the last five launches, and a confirmation before you stop an agent that is working. It shows when an agent is waiting for its subagents, lists sessions you started yourself while they are in use, and shows work that waits for a person as **On hold** rather than as an error. If the agent stops on an error, its tasks get a history entry and return to Idle so another agent can take them over.
- **Smaller improvements.** The settings buttons are centered, Docs gets a comparison with AI-DLC and spec-driven development, and the home icon is white.

### Fixes

- **A wait is no longer woken by a save that changes nothing.** An agent waiting with `agboard wait` could be woken when another tool saved a task file without changing it. The wait now confirms the change first; a real change is still reported about a quarter of a second later.
- **Restarting ngrok no longer hangs.** Starting the remote connection again after a stop completes instead of waiting forever.
- **Fewer layout glitches on the phone.** The scrollbar no longer covers cards, and the header, bottom bar, and drawers keep clear of the screen edges.

### Breaking changes

- Two files saved by this version are refused by earlier versions of `agboard`: a task with a result records it in its `task.json`, and a saved ngrok domain is written to `monitor-connection.json`. After you use v1.6.0 on a data area, do not go back to an older `agboard` on the same data.
- An epic's task order is now `waves`. `agboard epic edit --priority` and the `priority` list in `EPIC.md` are replaced by `--waves` and `waves`; an existing `priority` list is no longer applied, so set the waves again.
- `agboard remote` is now `agboard show remote` (with `--project` to print the address and passcode).

### Required update steps

Update the command:

```sh
brew upgrade fooqoo/tap/agboard
```

Restart `agboard serve` after the upgrade, then run `agboard update` once. It is needed for this release: the Agent Board hook for Claude Code and Codex now also runs when an agent ends a turn (`Stop`), and Codex runs a plugin's hooks only after you trust the changed hook definition. To get notifications on an iPhone, add the board to its Home Screen and enable them in the settings.

## v1.5.2

A release that retells the first steps around Ask AI: you send a request, the agent plans it as tasks, you answer its questions, and the tasks reach Done on their own.

### Changes

- **A new first-run guide.** The guide now walks through the way you work with Agent Board: send a sample request with **Ask AI**, see the agent turn it into an epic and draft tasks with acceptance conditions, answer the agent's question, then watch it start the plan and move the cards to Done. It is still simulated in your browser and changes nothing on your board. Open it again any time from **Settings**, **Tutorial**, **Try it**.
- **A new demo video and guide pages.** The video on the documentation site and the introduction follow the same story, from a request with **Ask AI** to automatic Done. The Quickstart starts with **Ask AI**, and its hands-on practice sends a request and plays the agent that takes it. The guide's screenshots show the current board.

### Fixes

None.

### Breaking changes

None.

### Required update steps

Update the command:

```sh
brew upgrade fooqoo/tap/agboard
```

Restart `agboard serve` after the upgrade. `agboard update` is not needed: this release changes no hook command, so the plugin updates itself at the first agent session after the upgrade.

## v1.5.1

A release that makes the PC board work better on a tablet, stops a stopped server from hanging, and leaves adding tasks to agents and the CLI.

### Changes

- **Swipe between tabs on a tablet.** On the PC board with a touch screen, swipe the task details panel sideways to move to the next or previous tab; the next tab follows your finger, as the tabs of a task do on a phone. A swipe anywhere in the body of the **Messages** modal switches between its tabs too. A mouse does not drag the panel, so you can still select text with it, and a swipe that starts on a button, a link, code, an image, or a table that scrolls sideways is left to that element.
- **Typing above a tablet keyboard.** When the software keyboard opens in a dialog, such as **Ask AI**, an answer, or the task editor, the dialog shrinks its header and footer and hides the fields you are not typing in, so the field you are typing in stays visible above the keyboard.
- **Remote connection settings stay on the computer.** A page opened through remote access no longer shows the **Remote connection** row in **Settings**, even on a tablet wide enough for the PC layout. Start and stop the connection on the computer that runs `agboard serve`.

### Fixes

- `agboard stop` and stopping the server from the board now end the server even when a Keychain request is still waiting for an answer, such as a macOS permission prompt nobody answered. Before, the server could keep running after it said it had stopped.
- Centered dialogs on an iPad no longer jump to the top of the screen when no text field has the focus, for example after a pinch zoom.
- The **Docs**, **Epics**, and **Archive** buttons in the header have the same width, and show only their icons on a narrower window.

### Breaking changes

The board no longer has a form for adding a task by hand: the menu beside **Ask AI** and its **Add a task manually** item are gone. Ask the agents with **Ask AI**, or add a task with `agboard add` (see [CLI](https://fooqoo.github.io/agent-board/guide/reference/cli)). Agents and the CLI create tasks as before, and editing an existing task in the full editor is unchanged.

### Required update steps

Update the command:

```sh
brew upgrade fooqoo/tap/agboard
```

Restart `agboard serve` after the upgrade. `agboard update` is not needed: this release changes no hook command, so the plugin updates itself at the first agent session after the upgrade.

## v1.5.0

A release that lets the board keep an agent on the job: start a Claude Code or Codex session from the board's Settings, and it stays attached, and the board hands it your requests, answers, and tasks while it is idle.

### Changes

- **Start an agent session from the board.** Open **Settings**, choose **Resident session settings** on the **Resident session** row, and start one headless Claude Code or Codex session in the project's folder from the dialog that opens. There is one such session in total, whichever tool or project. The board sends it your requests, the answers to its own questions, and tasks that are ready, only while it is idle: the open requests together in one message, the answers together in one message, and tasks one at a time. The session does not run `agboard wait` itself. Choose its model first: for Claude Code, the default or `opus`, `sonnet`, `haiku`, or `fable`; for Codex, one from its own model list. The `claude` or `codex` command must be on the `PATH` of `agboard serve` and signed in.
- **It runs unattended, with automatic approval.** Nobody watches a session the board starts, and it never stops to ask you: Claude Code runs in auto mode and Codex in its workspace-write sandbox with automatic review. Automatic review can approve actions you would not. Start these sessions only in projects you trust, and stop the session from the board when you are done. The dialog warns about this each time. Only the board on your own computer can start or stop one; the phone connection cannot, and **Settings** hides the **Resident session** row on a page opened through remote access.
- **The board sends it work, in order.** When the session is idle, the board sends it the answers to questions that session asked, then your open requests, then the first task that is ready. Requests you already accepted and tasks already running are not sent again. Claude Code is driven over its two-way stream-json mode and Codex over `codex app-server`, so the board knows when a session is attached, working, or waiting without a wait command. Permissions behave as before.
- **It keeps itself running.** If the session stops by itself, the board starts it again with a growing delay, and marks it failed after repeated crashes until you start it again. A session that never attaches is replaced. The session asks you questions only on the board, and keeps working on other tasks while it waits for the answer.
- **Items it cannot handle are shown, not retried forever.** If an item is not handled, the board sends it again after 30 seconds, then 5 minutes, and after the third failure stops sending it. The dialog and the PC footer then show **Some items could not be handled** with each item's name and the reason. Handle the item on the board, or restart the session.
- **Start it with Agent Board.** Turn on **Start automatically when Agent Board starts** in the dialog, and the board starts the session with the tool, model, and project you had open each time Agent Board starts. Turning this off does not stop a running session.
- **See what is attached.** The dialog shows the session's state, which stays on **Working on a task** while it works, and how many agent sessions are attached to the board, counted as sessions the board started and sessions you started yourself. On the PC, the footer shows the tool with a dot while a session is started or auto-start is on, and clicking it opens the dialog. On the phone board, the same indicator is display-only in the status line at the bottom, after the connection state. A session you started yourself and left on `agboard wait --until task` is not affected: it keeps waiting on the board, counts beside the board's session as an external session, and is never limited.
- **Keep any session on the board.** The new `wait` skill (`/agent-board:wait` in Claude Code) keeps the session you are talking to on the board: it listens with a 3600-second idle timeout when you give none, waits again after every `idle_timeout`, and stops only when you interrupt it or an error stops it. `agboard skills resident` prints the procedure a resident session follows.
- **Answer with only a note.** A question with choices can also be answered with a note alone, when none of the options fits. **Send answer** is enabled once you choose an option or write a note; a note-only answer has no choice in the history and in what agents receive.
- **A recommended task body.** The template from `agboard skills task-template` suggests the headings Background, What to do, Approach, and Verification results, written in the board's language. They are recommended, not required, and existing tasks stay valid.
- **Agents work in parallel worktrees.** The Skill tells an agent to start every task whose dependencies allow it without waiting to be told, and to give each task that changes a Git repository its own branch in its own worktree.
- **Remote access is generally available.** The **Public preview** badge and notice are gone from the **Remote connection** dialog and from the Remote access guide. [Feature stages](https://fooqoo.github.io/agent-board/guide/feature-stages) lists its supported range and limits among the generally available features.
- **Resident sessions are a public preview feature.** The **Resident session** dialog shows a **Public preview** badge and notice with a link to Feature stages. The session runs unattended with automatic approval and depends on the `claude` stream-json interface and on `codex app-server`, which Codex marks as experimental, so it may change when those CLIs update.
- **"Task listening" is now "Questions and requests".** It stays in public preview. A session you open yourself keeps itself on the board with `agboard wait --until task` or `/agent-board:wait`, and receives your requests, the answers to its questions, and tasks. Two sessions can still pick the same task; only requests and answers are protected, because the first `message accept` wins.

### Fixes

- Diagrams in documents and in the editor preview use the page's font and no longer clip the bottom of their labels, which was reported on a phone through remote access.
- Mermaid diagrams on the documentation site no longer cut off the bottom of their labels, most visibly on phones and in Japanese.

### Breaking changes

Questions saved by this version record which session asked them (`askedBy`), and earlier versions of `agboard` refuse to read such a file. After you use v1.5.0 on a data area, do not go back to an older `agboard` on the same data.

### Required update steps

Update the command:

```sh
brew upgrade fooqoo/tap/agboard
```

Restart `agboard serve` after the upgrade, and start new agent sessions. `agboard update` is not needed: this release adds the `wait` skill to the plugin and changes no hook command, so the plugin updates itself at the first agent session after the upgrade and applies from the session after that, and Codex trusts the unchanged hooks by itself. To start a session from the board, `claude` or `codex` must be installed and signed in on the computer that runs `agboard serve`.

`agboard update` is still useful when you turned the automatic update off, when there was no network or no `git` for it, when the agent told you the update did not complete, or to repair the plugin.

## v1.4.1

A release that removes approval requests: the agent starts its own AI drafts once its questions are answered, works on several tasks in parallel, and now gets its Agent Board instructions from the command itself, so a plugin update no longer needs a manual step.

### Changes

- **Approval requests are gone; the agent starts its own drafts.** The agent turns a request into AI drafts, asks its questions, and starts the drafts itself once they are answered, with `agboard start <ID> --actor ai` or `agboard epic start <EPIC-ID> --actor ai`. The board no longer shows an approval request or a start-approval screen.
- **The Skill works in parallel.** The main agent orchestrates and hands tasks to subagents, and it checks `nextTasks` to see what to run next.
- **The progress table lists the next tasks.** `agboard progress --json` and the hook output carry `nextTasks`: up to three recommended AI tasks, each with a `why`. The text `agboard progress` shows them under "Next tasks".
- **A `remote` skill gives you the phone URL.** `/agent-board:remote` hands out the phone URL and passcode for remote access.
- **Ask AI is a chat-style input.** The request is plain text with an image button and a send button in a bottom toolbar, images show as thumbnails you can remove, and closing the input asks before it discards what you typed. On a phone the sheet stays above the keyboard with its toolbar visible and only the field shrinks; on iOS the field no longer zooms the page.
- **Phone: Archive all on the Done tab.** **Archive all** sits below the cards on the Done tab.
- **The message band is simpler.** Its button is now **Questions & requests**, and each entry shows only its name and count; the "waiting to be picked up" note is gone from the band. On a phone, pressing a count opens the list on that tab.
- **Phone: swipe between message tabs.** Swipe sideways anywhere in the message list, even when a tab is empty, to switch its tabs.
- **Phone: the running icon spins.** The Running icon on cards in the phone lanes rotates, as on the desktop board; it stays still when the system asks for reduced motion.
- **Phone: answering a question works like Ask AI.** The answer opens in a sheet that fills the screen above the keyboard, with the buttons in a footer. Opened from the message list, its secondary button is **Back to list**; opened from a card, it is **Later**. Markdown in the question, including tables and code blocks, fits the sheet and scrolls inside it.
- **Tablets: dialogs stay above the keyboard.** When the on-screen keyboard opens, a centered dialog moves into the visible area and shrinks to fit, so its buttons stay reachable.
- **Every Markdown editor looks the same.** Markdown editors share the Ask AI frame and padding.
- **The Skill text now comes from `agboard`.** `agboard skills` prints the instructions of the `agent-board` skill, and the plugin's skill only runs it. After you upgrade `agboard`, even a session that is already open gets the new instructions the next time it uses the skill.
- **The plugin updates itself.** When an agent session starts and its Agent Board plugin differs from the one your `agboard` ships, `agboard` reinstalls the plugin in the background; it applies from the following session. Set `AGBOARD_NO_PLUGIN_AUTO_UPDATE=1` to turn this off.
- **The documentation calls Agent Board a shared workspace** instead of a work harness.

### Fixes

- **The board no longer gets stuck showing an empty project.** When a project's files were deleted and written back while `agboard serve` was reading them, the board could keep showing no tasks until the next change. It now reads the files again on every reload.

### Breaking changes

- **`start_approval` is removed.** The `start_approval` question kind and the approval UI are gone. An agent or script that asks a `start_approval` question must place the plan as AI drafts, ask its questions, and start the drafts with `--actor ai` once they are answered.

### Required update steps

Update the command and start new agent sessions:

```sh
brew upgrade fooqoo/tap/agboard
```

Restart `agboard serve` after the upgrade, and start new agent sessions. `agboard update` is not needed. The first agent session after the upgrade starts the plugin update in the background, and the new plugin applies from the session after that; the Skill text is already the new one, because it comes from `agboard`. Codex trusts the new hooks by itself when the hook definition is the one your `agboard` ships.

`agboard update` is still useful when you turned the automatic update off, when there was no network or no `git` for it, when the agent told you the update did not complete, or to repair the plugin.

## v1.4.0

A release that turns questions into messages: the AI's questions and your requests to the AI share one band, and a plan the AI proposes is reviewed and started as one card.

### Changes

- **Messages on the board.** A **Messages** band above the lanes shows **AI's questions** (questions and plans to approve) and **Your requests** (waiting to be picked up). **Open the list** to answer a question, review a plan, or withdraw a request. On a phone the list opens as a bottom sheet.
- **Ask AI.** **Ask AI** in the header, and on the phone's band, sends the agents a request written in the same rich editor as a task, with pasted or attached images. A request is not tied to a task or an epic; it shows as **Waiting to be picked up** until an agent accepts it. Adding a task yourself stays in the menu next to it, as **Add a task manually**.
- **Plans start when you say so.** Tasks and epics an agent creates are AI drafts. They are not shown as lane cards: one dashed **Proposed plan** card at the top of Todo, or its row in the list, opens a review with the goal, the tasks that will start, and the open questions. **Start with this plan** starts them, and **Later** leaves them as they are. A plan cannot start while a question about it is unanswered. Only a person can start a plan, also from the command line with `agboard epic start <EPIC-ID>` or `agboard start <id>`.
- **One file per question or request.** Each question and request is one Markdown file, and its answer or acceptance is written into the same file. A question has choices or none; without choices it is answered in words. The commands are `agboard message ask`, `answer`, `send`, `accept`, `ls`, `show`, `withdraw`, `wait`, `link`, and `unlink`.
- **Agents pick up requests.** Open requests appear in the progress table and the hook output, `agboard wait --until task` returns them before any task, and an agent takes one with `agboard message accept`, so two agents do not take the same request.
- **Agents receive your answers.** An answer an agent has not taken in yet appears in the progress table and the hook output, and `agboard wait --until task` returns it first. The agent records that it took the answer in with `agboard message accept`; `agboard message ask` and `agboard message wait` do this for the answers they return. Until then the question stays in **AI's questions** as **Answered, waiting for an AI**, where you can read your answer, and it is not counted as waiting for you.
- **Simpler waiting.** A task waits (Pending) only while a question it refers to has no answer, or a file it refers to cannot be read.
- **完了条件 in Japanese.** The Japanese screens and documentation call acceptance conditions 完了条件.
- **The guide follows the new work model.** The user guide explains the Messages band, Ask AI, and the plan review, and the guide's pages are arranged around how you hand work to agents.

### Fixes

- Replacing a task's body with `agboard edit --desc-file` no longer drops the task's references to its questions.
- iOS Safari no longer enlarges the text in a wide table column.
- On a phone or tablet, typing in the rich editor (Ask AI, adding or editing a task) no longer makes iOS zoom the page in.
- The Messages band keeps its margin above the lanes, and the project switcher keeps a finger-sized button in a crowded header on a touch screen.
- The first-run guide no longer loses its highlight when the board appears after the guide opens.

### Breaking changes

- **`agboard qa` is replaced by `agboard message`.** The API moves from `/api/projects/{id}/qa…` to `/api/projects/{id}/messages…`, and the board summary returns `messages`.
- **Start approvals are gone.** An agent no longer asks a "start this plan?" question. It places the plan as AI drafts, and a person starts it from the board or the command line. Questions no longer have a `kind`.
- **`isDraft` is replaced by `draft`.** Task and epic files and the API use `draft` with `null`, `human` (a person's unsaved draft), or `ai` (an agent's proposal).
- **Earlier questions are converted once.** On first read, unanswered questions move to the new files and answered ones are dropped. An unanswered start approval becomes AI drafts of the tasks it covered, which you start from the board.

### Required update steps

Update the command, then move the plugin to the same version:

```sh
brew upgrade fooqoo/tap/agboard
agboard update
```

`agboard update` is needed: the Skill now tells agents to accept requests and answers and place plans as AI drafts with `agboard message`, and the plugin's version must match the command; otherwise a new agent session asks you to run it. Restart `agboard serve` after the upgrade, and start new agent sessions so they load the new Skill.

## v1.3.0

A release that brings the whole board to your phone: below 768px the board shows one lane at a time, and the ngrok address opens the same board behind its passcode.

### Changes

- **One board for every screen.** Below 768px wide, the board shows its phone screen; at 768px and wider, the lanes. The mobile monitor is no longer a separate page: the ngrok address opens this same board, and the project switcher in the header lists every project, as on the PC.
- **One lane at a time on the phone.** Tabs at the top show each lane with its number of cards. Tap a tab, or swipe sideways, to change lanes.
- **Move and archive cards from the phone.** Hold a card to choose it, then swipe it to show its buttons: move it to the next or the previous lane, or archive it after a confirmation. The Done lane has **Archive all**, which is unavailable while the lane is empty. Deleting for good is still done from the archive.
- **The Unanswered questions band starts closed.** Its header shows how many questions are open. Open it to list them, pick one to answer it alone, or answer them all with **Answer them**. This is the same on the PC and the phone.
- **`agboard remote` hands you the phone link.** While the ngrok connection is up, `agboard --project "<name>" remote` prints the connection state, the address of that project, and the passcode, and `--json` prints them as JSON, so an agent can give you a link without you opening the connection dialog. It runs on the PC only and starts nothing.
- **The first-run guide works on the phone and through ngrok.** The guide now runs in the browser only: its sample cards and the agent's moves are drawn on the screen, and the board keeps only whether you have seen it. **Try it** under **Tutorial** in the settings shows it again, on the PC or the phone.
- **Easier to use with a finger.** Touch screens get larger buttons, a card can be dragged at once from its grip, and the board and its dialogs keep their size while a tablet's or phone's keyboard is open. The field you type in stays above the keyboard.

### Fixes

- Opening a dialog or an answer sheet on a touch screen no longer brings up the keyboard before you choose a field.
- On a tablet, the keyboard no longer squashes the board and an open dialog into the strip above it.
- The **Docs** label stays visible on a tablet held sideways.

### Breaking changes

- **The ngrok address opens the whole board.** Whoever enters the 4-digit passcode can use the board for up to 12 hours, as on the PC: read every project, and add, edit, move, archive, and delete tasks and epics. Earlier versions only let the phone answer questions and check conditions. Only the connection settings stay on the PC. Give the passcode only to people you would let use your board.
- **Addresses ending in `/monitor/` are no longer served.** The separate monitor page and its API are removed, and old links show a not-found answer; there is no redirect. On the PC, open the mobile connection settings, scan the current QR code again, and replace saved bookmarks with the new address.

### Required update steps

Update the command, then move the plugin to the same version:

```sh
brew upgrade fooqoo/tap/agboard
agboard update
```

`agboard update` is needed: the Skill now tells agents how to open the board on your phone with `agboard remote`, and the plugin's version must match the command; otherwise a new agent session asks you to run it. Restart `agboard serve` after the upgrade so the phone loads the new board.

## v1.2.1

A release that lets you answer a task's questions from its card and send them at once, and that makes the board's buttons safe to press twice.

### Changes

- **Answer a task from its card.** **Answer the question** on a card now opens only the questions that task waits on, and **Send** on the last of them sends the answers at once, with no review step. Answers you hold for other tasks are not sent. The **Unanswered questions** band still lets you answer every question and send them together with **Send all**. The mobile monitor works the same way.
- **The browser demo is simpler.** It starts with a single project named `demo` and one unanswered question.

### Fixes

- Pressing a button of the first-run guide twice, such as **Finish and get started**, no longer shows an error. The guide's buttons and an epic's delete and finalize now wait for the first press to finish.
- The guide's spotlight now covers its sample cards, instead of other cards at the top of the lane.

### Breaking changes

None.

### Required update steps

Update the command, then move the plugin to the same version:

```sh
brew upgrade fooqoo/tap/agboard
agboard update
```

The Skill and the Hook do not change, but `agboard update` is needed so that the plugin's version matches the command; otherwise a new agent session asks you to run it.

## v1.2.0

A release that lets you hand a request to an agent and answer its questions in one place, with a plugin that sets up your agents in one step.

### Changes

- **Set up your agents with one command.** `agboard setup` installs the Agent Board plugin, which holds the Skill and the Hook, for Claude Code, Codex, or both. It works in any folder, needs no project, and runs without prompts with `--agent` and `--yes`. In Codex, it also trusts the plugin's hooks after you agree.
- **Keep the plugin current.** `agboard update` moves the plugin to the version of your command and trusts the new Codex hooks again. When the plugin and the command differ, a new agent session asks you to run it.
- **Hand over a request, then approve one plan.** When you ask for work that spans several tasks, the agent puts a provisional plan on the board first, asks what it cannot decide, and then asks once for approval to start. Its tasks wait until you approve.
- **Answer questions in one place.** Questions belong to the project, and a task refers to the ones it waits on. The **Unanswered questions** band above the lanes lists every open question. You answer them one after another and send them together with **Send all**, on the board or on the phone. An agent in a conversation also asks in the chat, and the first answer, from either place, is the one that counts.
- **Moving a task no longer withdraws its question.** A question stays open until it is answered or the agent withdraws it.
- **The board starts by itself.** A command that needs the server, such as a waiting question, `wait`, or the hook, starts it in the background and opens the project's board in your browser once. It stops after 30 minutes without use. `agboard open` opens the board of the current project.

### Fixes

- The board no longer stops answering when your operating system asks whether Agent Board may use the ngrok token saved on this PC, for example after an update. Only connecting with the saved token and deleting it wait for your answer.
- After an agent reads an image or runs a command with long output, the Hook still adds the board's progress table. It used to report `hook_input_too_large` instead, and the agent had to read the board again.

### Breaking changes

- `agboard connect` is removed. `agboard setup` installs the Skill and the Hook as a plugin instead.
- `agboard update` now updates the plugin. It skips an agent that does not have the plugin and tells you to run `agboard setup`.
- `agboard state <id> pending` is removed. Agents ask with `agboard qa ask` and wait with `agboard qa wait`.
- A question that was still open in an earlier version is not carried over. When you upgrade, it disappears from its task.

### Required update steps

Before you upgrade, answer any open questions on the board.

Then update the command and install the plugin:

```sh
brew upgrade fooqoo/tap/agboard
agboard setup
```

`agboard update` is not enough this time, because the plugin is not installed yet; run `agboard setup` once. Later releases need only `agboard update`.

The Skill and the Hook that `agboard connect` installed are not removed for you. Remove the `agent-board` Skill folder and the hook entries that run `agboard hook` from your agent's settings, so the Hook does not run twice.

## v1.1.1

A release with one fix to how the board reads files that change while they are being read.

### Changes

None.

### Fixes

- The board no longer keeps showing missing or outdated tasks after another program deletes and rewrites a project's files while the board is reading them.

### Breaking changes

None.

### Required update steps

Update the command:

```sh
brew upgrade fooqoo/tap/agboard
```

The Skill and the Hook do not change, so `agboard update` is not needed.

## v1.1.0

A release with fixes for the board in Safari and on iPad, and a Skill that confirms a breakdown before it adds cards.

### Changes

- **Break a request into tasks.** When you ask an agent for work that is more than one task, the Skill now has it propose the tasks, their order, and the epic, and add them to the board only after you say yes. See [Break a request into tasks](./guide/delegate/agents.md#break-a-request-into-tasks).

### Fixes

- The board keeps updating while a side panel is open.
- Dialogs are no longer drawn off to the side in Safari and on iPad.
- The board page itself no longer scrolls up or down.
- A project created with the CLI no longer shows "Project not found" when opened at once.
- An answered question on the mobile monitor no longer flashes as withdrawn.

### Breaking changes

None.

### Required update steps

Update the command:

```sh
brew upgrade fooqoo/tap/agboard
```

This release changes the Skill. Run `agboard update` to bring the installed Skill up to date; the Hook does not change. Start a new agent session afterwards so the agent loads the new Skill.

## v1.0.0

Agent Board is a local board for sharing tasks, progress, and decisions with Claude Code and Codex. The first public release brings Homebrew installation and guided agent setup to macOS.

This release mixes two stages. The board, tasks, decisions, epics, the CLI that agents use, `connect` and `update`, and the first-run welcome are generally available (GA). Docs, task listening, and the mobile monitor are in public preview, so their behavior may change in a later release. See [Feature stages](./guide/feature-stages.md) for what each stage means and the current limits. GA does not mean free of bugs or a promise that nothing will ever change.

### Changes

- **Install with Homebrew.** `brew install fooqoo/tap/agboard` installs a prebuilt, signed command with the web UI included. You do not build Agent Board from source.
- **Connect your agents.** `agboard connect` asks which agents to set up and where, then installs the Skill and the Hook for Claude Code, Codex, or both. It shows every change before it writes, backs up the files it changes, and never overwrites your own edits.
- **Keep a Hook quiet where it does not apply.** A Global Hook in a folder that is not bound to a project exits normally with no output, so the agent keeps working.
- **Update the Skill and Hook.** `agboard update` brings installed Skills and Hooks up to the version of your command, and ordinary commands tell you when they are older.
- **Answer from your phone.** The mobile monitor connects through ngrok and a passcode. (public preview)

Requires macOS 15 or later on Apple Silicon or Intel. Agent Board itself is MIT-licensed; bundled third-party components keep their own licenses, listed in `THIRD_PARTY_NOTICES.txt`.

### Fixes

This is the first public release, so there are no fixes to an earlier public version.

### Breaking changes

None. There is no earlier public release to break.

### Required update steps

A new installation needs no update steps:

```sh
brew install fooqoo/tap/agboard
cd my-project
agboard project create "My project"
agboard connect
agboard serve
```

For later releases, update the command with `brew upgrade fooqoo/tap/agboard`. When a release changes the Skill or the Hook, run `agboard update`, then review the changed Hook with `/hooks` in your agent. Read [Install and start](./guide/getting-started.md) and [Working with agents](./guide/delegate/agents.md).
