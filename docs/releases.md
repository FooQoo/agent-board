# Release notes

What changed in each published version of Agent Board, newest first. Each version also has a [GitHub Release](https://github.com/FooQoo/agent-board/releases) with its downloads.

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
