# v1.0.0 release specification

The distribution, connect, update, and documentation contract of v1.0.0. This page states the contract; the [user guide](../../guide/index.md) describes the behavior, and a version counts as released only when its GitHub Release is published.

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

## Signing and notarization

Each CPU's binary in a formal release is signed with a Developer ID Application certificate, with Hardened Runtime, a secure timestamp, the same Team ID on both CPUs, and the fixed identifier `io.github.FooQoo.agent-board.agboard`. The release uses the default Developer ID designated requirement and does not pin a binary hash. The signed binary is submitted to Apple notarization as a ZIP, and only after the status is `Accepted` are the same bytes packed into the per-CPU tar.gz, hashed into `SHA256SUMS`, and used for the GitHub Release and the Formula. A single command-line binary cannot carry a stapled ticket, so macOS checks the notarization online at first launch. Installing never requires turning off Gatekeeper. Notarization uses an App Store Connect API key, not an Apple ID password. No secret value is passed on a command line: the certificate password is read by `openssl` from the environment and replaced by a random one-time passphrase before `security import`, and the API key goes to `notarytool` as a 0600 file. Every GitHub Action in the release workflow is pinned to a full commit SHA.

The signing secrets (`MACOS_CERT_P12`, `MACOS_CERT_PASSWORD`, `APPLE_TEAM_ID`, `APP_STORE_CONNECT_API_KEY`, `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`) exist only in the protected `release-signing` environment, for a pushed `v*` tag. Pull requests and manual builds produce an unsigned candidate and never a release file. A missing certificate, a rejected or timed-out notarization, or one failing CPU stops the release; there is no unsigned fallback. The Team ID and identifier stay the same from release to release. The developer procedure is in [Build release](../getting-started/setup.md#build-release).

## Hook project resolution

Resolve the nearest binding from the Hook input's cwd, falling back to the process cwd when it is missing, `null`, or empty. A Global Hook also starts in unbound folders, but a normal unbound result produces no stdout or stderr, exits with code 0, and injects no progress. An explicit --project takes precedence.

Report broken bindings, missing bound projects (`bound_project_missing`), malformed input and a `cwd` of the wrong type or a relative path (`invalid_hook_input`), and a `cwd` that does not exist or cannot be read (`hook_cwd_unavailable`) as AGBOARD_ERROR with a diagnostic cause. Do not fall back to another project in a parent folder. Ordinary `agboard progress` retains its folder_unbound error. A Global Skill must not guess another project for an unbound folder.

## Updating Skills and Hooks

`agboard update` previews changes and asks for y/N confirmation. `agboard update --yes` skips only the confirmation. Target recorded Global installations and Project installations at the current nearest bound root. Global installations can be updated from an unbound folder. Do not scan other projects, reselect agents or scopes, or add permission changes.

Installation records retain the agent, component, scope, resolved location, installed version, managed hashes, and the Project binding association. Even with --yes, do not overwrite user modifications. Success, no change, and cancellation exit with code 0; failure or conflict exits with code 1; usage errors, including noninteractive execution without --yes, exit with code 2. Write failure reasons to stderr. Do not add update-specific --json or --dry-run; reject the global --json option in combination with update.

After a CLI upgrade, interactive ordinary CLI operations can suggest `agboard update` on stderr when installed assets differ. Keep the operation's original result and exit status. Do not pollute Hook or JSON output, or continuous wait/serve output. Preserve existing data compatibility handling without adding a complex migration framework.

## Official documentation and release history

The English and Japanese VitePress headers show the published version and link to GitHub Releases. `/releases` and `/ja/releases` list changes, fixes, breaking changes, and required update actions, newest first. Published GitHub Releases are the canonical release history. Do not display the development Cargo version on main as the published version. Do not add a documentation version switcher.

Installation guides explain Homebrew, connect, update, bind, the Global/Project distinction, unbound Hook skips, and trust approval. Use the existing VitePress theme without adding application UI or new Pencil mockups.

## Feature stages

Every feature of v1.0.0 is generally available (GA) or in public preview. GA means the feature is kept as it is for a good while; it does not mean free of bugs or an unlimited compatibility or support promise. Public preview means the behavior may change. v1.0.0 mixes both. In public preview are Docs, `connect` and `update`, task listening (`wait --until task`), the mobile monitor, and the first-run welcome. The screens of Docs, the mobile connection settings, and the welcome show a badge and a notice with a link, and the interactive screens of `connect` and `update` start with one line. [Feature stages](../../guide/feature-stages.md) is the single place that lists the stages and limits; the product shows its text and links to it.
