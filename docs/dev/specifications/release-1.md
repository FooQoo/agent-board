# v1.0.0 release specification

Approved specification for implementation. The connect/update commands and distribution described here are not a claim that they are implemented or released. See the [user guide](../../guide/index.md) for current behavior.

[日本語](../../ja/dev/specifications/release-1.md)

## Distribution and installation

Agent Board is distributed under the MIT license for macOS 15 or later on Apple Silicon (arm64) and Intel (x86_64). The first release is version 1.0.0 with the tag v1.0.0. `brew install fooqoo/tap/agboard` installs a prebuilt binary with the web UI embedded. Users do not need Rust or Node.js to compile Agent Board. Homebrew's own prerequisites, including Command Line Tools where required, are documented separately.

```sh
brew install fooqoo/tap/agboard
cd my-project
agboard project create "My project"
agboard connect
agboard serve
```

`project create` binds the working folder automatically. Use `project bind` for an existing project. The server opens on 127.0.0.1:7420. Update the CLI with `brew upgrade fooqoo/tap/agboard`. Windows/Linux distribution, CLI self-updates, and support for macOS 13/14 are outside the first release.

## connect

`agboard connect` displays the project and root of the nearest folder binding. If there is no binding, it explains how to create or bind a project and exits without selecting another project. Project settings are installed at the bound root even when connect runs in a subfolder.

Users can select multiple detected agents from Claude Code and Codex. They choose one Global or Project scope for Skills, shared by all selected agents, and choose the Hook scope independently. Undetected agents are explained with installation instructions and are not reported as available or successfully connected. The command previews locations, permissions, duplicate-registration moves, and backups before asking for confirmation. Without an interactive terminal, it explains the requirement and exits without waiting for input.

| Component | Global | Project |
| --- | --- | --- |
| Claude Code Skill | `~/.claude/skills/agent-board/` | `<bound-root>/.claude/skills/agent-board/` |
| Claude Code Hook | `~/.claude/settings.json` | `<bound-root>/.claude/settings.json` |
| Codex Skill | `~/.agents/skills/agent-board/` | `<bound-root>/.agents/skills/agent-board/` |
| Codex Hook | `~/.codex/hooks.json` | `<bound-root>/.codex/hooks.json` |

Honor effective configuration locations, including CLAUDE_CONFIG_DIR and CODEX_HOME overrides. Codex Skills follow the `.agents/skills` rules independently of CODEX_HOME. Embed SKILL.md, references, assets, and Hook templates in the binary; installation must not require a Git clone. Keep setup as the existing permissions-only command.

Merge only necessary keys and managed entries into existing settings. Repeating the same configuration must not create duplicates or unnecessary backups. Protect user edits and concurrent changes to managed content as conflicts. A managed Hook scope migration previews both removal and addition. An unmanaged duplicate stops the change without deleting the user's registration.

Do not relax permission modes, managed policies, or Hook trust and approval. When automatic permission changes are inappropriate, such as a Codex permission scheme other than workspace-write, provide manual instructions. Distinguish writing files from the agent loading them; show remaining work such as restart and Hook approval for each agent.

Back up changed files before atomic writes. On failure, restore the changes made for that agent without undoing another agent's successful installation. Report partial success, locations, and recovery status with a nonzero exit code. Managed hashes detect user changes; they do not authenticate distribution sources or prevent malicious direct file edits.

## Hook project resolution

Resolve the nearest binding from the Hook input's cwd, falling back to the process cwd when unavailable. A Global Hook also starts in unbound folders, but a normal unbound result produces no stdout or stderr, exits with code 0, and injects no progress. An explicit --project takes precedence.

Report broken bindings, missing bound projects, malformed input, and read or permission failures as AGBOARD_ERROR with a diagnostic cause. Do not fall back to another project in a parent folder. Ordinary `agboard progress` retains its folder_unbound error. A Global Skill must not guess another project for an unbound folder.

## Updating Skills and Hooks

`agboard update` previews changes and asks for y/N confirmation. `agboard update --yes` skips only the confirmation. Target recorded Global installations and Project installations at the current nearest bound root. Global installations can be updated from an unbound folder. Do not scan other projects, reselect agents or scopes, or add permission changes.

Installation records retain the agent, component, scope, resolved location, installed version, managed hashes, and the Project binding association. Even with --yes, do not overwrite user modifications. Success, no change, and cancellation exit with code 0; failure or conflict exits with code 1; usage errors, including noninteractive execution without --yes, exit with code 2. Write failure reasons to stderr. Do not add update-specific --json or --dry-run; reject the global --json option in combination with update.

After a CLI upgrade, interactive ordinary CLI operations can suggest `agboard update` on stderr when installed assets differ. Keep the operation's original result and exit status. Do not pollute Hook or JSON output, or continuous wait/serve output. Preserve existing data compatibility handling without adding a complex migration framework.

## Official documentation and release history

The English and Japanese VitePress headers show the published version and link to GitHub Releases. `/releases` and `/ja/releases` list changes, fixes, breaking changes, and required update actions, newest first. Published GitHub Releases are the canonical release history. Do not display the development Cargo version on main as the published version. Do not add a documentation version switcher.

Installation guides explain Homebrew, connect, update, bind, the Global/Project distinction, unbound Hook skips, and trust approval. Use the existing VitePress theme without adding application UI or new Pencil mockups.
