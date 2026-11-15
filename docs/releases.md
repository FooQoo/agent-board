# Release notes

What changed in each published version of Agent Board, newest first. Each version also has a [GitHub Release](https://github.com/FooQoo/agent-board/releases) with its downloads.

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

If you are upgrading from v1.1.x, v1.2.0's changes apply as well. Answer any open questions on the board before you upgrade, run `agboard setup` instead of `agboard update`, and remove the Skill and the Hook that `agboard connect` installed. See [v1.2.0](#v1-2-0) for details.

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

- **Break a request into tasks.** When you ask an agent for work that is more than one task, the Skill now has it propose the tasks, their order, and the epic, and add them to the board only after you say yes. See [Break a request into tasks](./guide/automation/agents.md#break-a-request-into-tasks).

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

For later releases, update the command with `brew upgrade fooqoo/tap/agboard`. When a release changes the Skill or the Hook, run `agboard update`, then review the changed Hook with `/hooks` in your agent. Read [Install and start](./guide/getting-started.md) and [Working with agents](./guide/automation/agents.md).
