# AGENTS.md

Read the page for the area you are about to change. Start with [docs/dev/index.md](docs/dev/index.md) if you are new to the code. Use the [user guide](docs/guide/index.md) for screen layouts, visible behavior, and user operations, and the developer guide for architecture and implementation details. Update the relevant pages and their Japanese translations under `docs/ja/` in the same change as the behavior they describe.

| When you need | Read |
| --- | --- |
| The overall design and how a change travels through the system | [docs/dev/concepts/overview.md](docs/dev/concepts/overview.md) |
| Projects, tasks, lanes, run states, epics, drafts, and archive | [docs/dev/concepts/tasks-and-states.md](docs/dev/concepts/tasks-and-states.md) |
| History, decision requests, acceptance conditions, and automatic Done | [docs/dev/concepts/history-and-decisions.md](docs/dev/concepts/history-and-decisions.md) |
| Locks, atomic saves, recovery, and invalid files | [docs/dev/concepts/saving-and-recovery.md](docs/dev/concepts/saving-and-recovery.md) |
| Versions, file watching, and live updates | [docs/dev/concepts/notifications.md](docs/dev/concepts/notifications.md) |
| Request handling, the web UI, and its failure behavior | [docs/dev/concepts/server-and-ui.md](docs/dev/concepts/server-and-ui.md) |
| The skill, the hook, `wait`, and `setup` | [docs/dev/concepts/agents.md](docs/dev/concepts/agents.md) |
| The mobile monitor | [docs/dev/concepts/remote-access.md](docs/dev/concepts/remote-access.md) |
| What is protected and what is not | [docs/dev/concepts/security.md](docs/dev/concepts/security.md) |
| Every stored file and its fields | [docs/dev/reference/files.md](docs/dev/reference/files.md) |
| Endpoints, error codes, and the JSON agents receive | [web-api](docs/dev/reference/web-api.md), [errors](docs/dev/reference/errors.md), [agent-output](docs/dev/reference/agent-output.md) |
| Monitor routes and the code map | [monitor routes](docs/dev/reference/remote-routes.md), [code-map](docs/dev/reference/code-map.md) |
| A failure you cannot explain | [docs/dev/troubleshooting.md](docs/dev/troubleshooting.md) |
| Board, cards, and decisions as users see them | [board](docs/guide/use/board.md), [decisions](docs/guide/use/decisions.md), [editing](docs/guide/use/editing.md), [epics](docs/guide/use/epics.md) |
| CLI commands, data area, and mobile monitor for users | [cli](docs/guide/automation/cli.md), [data](docs/guide/operations/data.md), [mobile-monitor](docs/guide/operations/mobile-monitor.md) |
| Build, run, and install | [Set up and run](docs/dev/getting-started/setup.md) |
| Language, paths, privacy, doc updates, and UI checks | [Conventions](docs/dev/getting-started/pull-request.md#conventions) |
| Verification commands and test rules | [Verification](docs/dev/getting-started/pull-request.md#verification) |
| Documentation site, screenshots, and demo videos | [Documentation and images](docs/dev/docs-and-images.md) |

Always:

- Run the verification commands in [Verification](docs/dev/getting-started/pull-request.md#verification) before you finish.
- Point `AGBOARD_HOME` at a temporary directory in tests and never use port 7420.
- Never commit machine-specific absolute paths.

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
