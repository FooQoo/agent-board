---
title: CLI reference
---

# CLI reference

Use the browser to review and edit work, and `agboard` for agent updates and project management. Most commands take an explicit `--project NAME`; the examples use `My project`, so substitute your project name and the IDs the CLI returns.

## Add and inspect cards

Add a card and inspect the board:

```sh
agboard --project "My project" add "Write the setup guide" --assignee ai --actor ai
agboard --project "My project" ls --json
agboard --project "My project" show 1 --json
agboard --project "My project" snapshot --json
```

`--assignee` identifies the owner; `--actor` records who makes the change. Use `human` for a user and `ai` for an agent. `snapshot` returns the complete board and history, including epics and any file problems.

## Report work

Report the start of work:

```sh
agboard --project "My project" mv 1 doing --actor ai --reason "Start implementation"
agboard --project "My project" state 1 running --actor ai --reason "Writing and checking the guide"
```

To finish, record verification in `TASK.md` and set each verified acceptance item's `done` to `true`. A running server moves eligible AI cards to Done automatically; do not issue `mv ... done --actor ai`. See [shared Markdown files](./editing#edit-shared-markdown-files) for the format and eligibility rules. Done cards are read-only for agents: they cannot edit the task, change its lane or state, or add attachments or evidence. A user can reopen a card when more work is needed.

For decisions (`state ... pending`), see [Decisions](./decisions). For epics and the progress table, see [Epics and progress](./epics).

## Edit long text from a file

For longer Markdown, use a file rather than a command-line string:

```sh
agboard --project "My project" edit 1 --desc-file task.md
```

Descriptions and epic plans allow up to 50,000 characters. The file must follow the required [Markdown format](./editing#edit-shared-markdown-files). Use `--desc -` to read a description from standard input.

## Filter and list

Filter cards or inspect every project:

```sh
agboard --project "My project" ls --column doing --json
agboard --project "My project" ls --state pending --json
agboard ls --all-projects --json
```

`ls --all-projects` reads all projects consistently in project-name order, with complete card descriptions and history. Its `--column` and `--state` filters apply to every project; do not combine it with `--project`.

## Output and confirmation

Add `--json` for machine-readable output. Use `agboard --help` or `agboard <command> --help` for the full command options. The help text, errors, and JSON values are always in English, whatever language the browser uses.

Card, epic, evidence, and project deletion require human confirmation; agents must ask a user to perform them.
