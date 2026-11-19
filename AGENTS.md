# AGENTS.md

Read the page for the area you are about to change. Start with [docs/dev/index.md](docs/dev/index.md) if you are new to the code. Use the [user guide](docs/guide/index.md) for screen layouts, visible behavior, and user operations, and the developer guide for architecture and implementation details. Update the relevant pages and their Japanese translations under `docs/ja/` in the same change as the behavior they describe.

| When you need | Read |
| --- | --- |
| The overall design and how a change travels through the system | [docs/dev/concepts/overview.md](docs/dev/concepts/overview.md) |
| What the work model guarantees and where the code enforces it | [docs/dev/concepts/work-model.md](docs/dev/concepts/work-model.md) |
| Projects, tasks, lanes, run states, epics, drafts, and archive | [docs/dev/concepts/tasks-and-states.md](docs/dev/concepts/tasks-and-states.md) |
| History, decision requests, acceptance conditions, and automatic Done | [docs/dev/concepts/history-and-decisions.md](docs/dev/concepts/history-and-decisions.md) |
| Locks, atomic saves, recovery, and invalid files | [docs/dev/concepts/saving-and-recovery.md](docs/dev/concepts/saving-and-recovery.md) |
| Versions, file watching, and live updates | [docs/dev/concepts/notifications.md](docs/dev/concepts/notifications.md) |
| Request handling, the web UI, and its failure behavior | [docs/dev/concepts/server-and-ui.md](docs/dev/concepts/server-and-ui.md) |
| The skill, the hook, `wait`, and `setup` | [docs/dev/concepts/agents.md](docs/dev/concepts/agents.md) |
| Remote access | [docs/dev/concepts/remote-access.md](docs/dev/concepts/remote-access.md) |
| The browser demo and its suite | [docs/dev/concepts/demo.md](docs/dev/concepts/demo.md) |
| What is protected and what is not | [docs/dev/concepts/security.md](docs/dev/concepts/security.md) |
| Every stored file and its fields | [docs/dev/reference/files.md](docs/dev/reference/files.md) |
| Endpoints, error codes, and the JSON agents receive | [web-api](docs/dev/reference/web-api.md), [errors](docs/dev/reference/errors.md), [agent-output](docs/dev/reference/agent-output.md) |
| Entrance routes and the code map | [entrance routes](docs/dev/reference/remote-routes.md), [code-map](docs/dev/reference/code-map.md) |
| A failure you cannot explain | [docs/dev/troubleshooting.md](docs/dev/troubleshooting.md) |
| Board, cards, and decisions as users see them | [board](docs/guide/watch/board.md), [decisions](docs/guide/delegate/decisions.md), [editing](docs/guide/watch/editing.md), [epics](docs/guide/watch/epics.md) |
| CLI commands, data area, and remote access for users | [cli](docs/guide/reference/cli.md), [data](docs/guide/operations/data.md), [remote-access](docs/guide/watch/remote-access.md) |
| Build, run, and install | [Set up and run](docs/dev/getting-started/setup.md) |
| Language, paths, privacy, doc updates, and UI checks | [Conventions](docs/dev/getting-started/pull-request.md#conventions) |
| Verification commands and test rules | [Verification](docs/dev/getting-started/pull-request.md#verification) |
| Documentation site, screenshots, and demo videos | [Documentation and images](docs/dev/docs-and-images.md) |

Always:

- Run the verification commands in [Verification](docs/dev/getting-started/pull-request.md#verification) before you finish.
- Point `AGBOARD_HOME` at a temporary directory in tests and never use port 7420.
- Never commit machine-specific absolute paths.
- Talk with the user in the language the user writes in, in chat replies and in questions to the user.
- Write everything you put in the repository in English, apart from translations: code, comments, commit messages, pull request titles and bodies, documentation, and release notes. Translations, such as the Japanese pages under `docs/ja/`, `README.ja.md`, and localized UI resources, use their target language (see [Conventions](docs/dev/getting-started/pull-request.md#conventions)).

## Branches

Follow GitHub flow. `main` is always releasable, and every change reaches it through a pull request.

- Start each change on its own branch cut from the latest `main`, named `feature/<topic>` whatever the kind of change.
- Split a larger change, such as an epic, into pull requests of one small feature each, and plan the split when you plan the work. A good unit is one behavior a reviewer can check on its own, such as one endpoint, one CLI command, or one part of a screen, together with its tests and documentation. Keep each pull request well under 150 changed files, the most CodeRabbit reviews at once; it skips a larger pull request, so it would reach `main` without a review.
- Open the pull requests of one change together as a stack. Give each piece its own `feature/<topic>` branch cut from the branch of the piece it builds on, and point its pull request at that branch; the first piece points at `main`, and independent pieces can each point at `main`. Merge them from the bottom, the one that points at `main` first. When a piece is merged its branch is deleted, and GitHub retargets the next pull request to `main`. Each merge must leave `main` releasable: hold back a user-facing entry point, such as a button or a command, until the pieces behind it are in, or keep it behind a feature stage.
- When a lower piece changes after review, merge its branch into the pieces above it rather than rebasing them, so their reviews and history stay valid.
- Express the kind of change in the commit messages with [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `test:`, `ci:`, `refactor:`, `chore:`, and so on. Give the pull request title the same form.
- Never push commits directly to `main`, including small fixes to tests, CI, or documentation.
- Push the branch and open a pull request to `main`. Merge it after its CI passes. A job that was cancelled, or that failed for a known flaky reason unrelated to the change, can be re-run; do not merge over a real failure.
- Merge with a merge commit. Do not rewrite the history of `main` or force-push to it.
- After the merge, watch the CI run on `main` until it passes, and fix any failure on a new branch.
- Delete the branch, and any worktree made for it, once it is merged.

## Release notes

Write the notes of every release in the same shape, so that the documentation site can read them. See [Check published release notes](docs/dev/docs-and-images.md#check-published-release-notes) for how the site reads them.

- Write the GitHub Release body in English, and keep its review copy in `releases/vX.Y.Z.md`.
- Start with one sentence that says what the release is, then use these four headings in this order, each exactly once: `## Changes`, `## Fixes`, `## Breaking changes`, and `## Required update steps`.
- Keep a heading even when it has nothing to report, and write `None.` under it. A missing or repeated heading stops the documentation site build.
- Describe each change from the user's side, not as implementation history. Under `## Required update steps`, give the upgrade command and say whether `agboard update` is needed. The plugin updates itself at the next agent session, so it is needed only when that cannot do the job: Codex hook trust, or a release that changes the hook commands in a way an agent must trust again.
- Add the version to `docs/releases.md` and `docs/ja/releases.md` with `###` headings: Changes, Fixes, Breaking changes, Required update steps, and in Japanese 変更点, 不具合修正, 互換性に影響する変更, 必要な更新操作. Write `ありません。` under an empty Japanese heading.
- Before you publish, check the body with `node scripts/release/docs-release.mjs --releases-json <file>`.

## Documentation style

Write for people using or developing Agent Board. Apply these rules to the README and the documentation site, and follow [Documentation and images](docs/dev/docs-and-images.md) for preview and verification commands.

- Use plain, natural language. Japanese pages should read as Japanese documentation, rather than literal translations. Preserve the meaning and exact command names, paths, API fields, and other technical identifiers. Keep headings, navigation labels, and terminology consistent across pages.
- Split long prose into paragraphs at changes of topic. Use lists for steps, inventories, or parallel items. Avoid dense paragraphs that combine an operation, its constraints, and implementation details without a clear break.
- Describe the reader's purpose directly, such as learning the architecture or setting up development. Do not introduce public documentation as being "for people and agents" or "for agents." References to agents are appropriate when explaining the product's agent integration and behavior.
- For screen specifications and how to use the UI, link to the relevant user guide page. Keep those explanations in the user guide; developer documentation should explain the implementation and link to the guide for the user-facing behavior.
- Describe the current product. Do not add upgrade or migration instructions for historical development versions that have not been released or used by others. Keep implementation history out of usage instructions.
- Lay out system diagrams from left to right. Split a large diagram by purpose, keep labels concise, and put detailed explanations in nearby prose. Preserve readable text sizes; wide diagrams should scroll within their frame instead of shrinking every label to fit the page.
- Keep table columns wide enough to read. Allow horizontal scrolling inside a table rather than squeezing descriptions into narrow columns or making the whole page scroll sideways. Use deliberate line breaks for lists of technologies or identifiers. Let explanatory prose, especially a table's reason column, wrap naturally; do not insert a manual break after every sentence.
- Check the rendered Markdown, including bold text next to inline code or Japanese text. Confirm that formatting markers are not visible as literal text. Verify changed layouts at desktop and phone widths, in light and dark themes; a successful build alone does not establish readability.
- Keep the English source and Japanese pages aligned. For content changes, build the documentation site and check links. After changing site content or appearance, refresh the preview using the latest build, restart the preview server when needed, and show the affected page with a working preview link without waiting for the user to ask.
