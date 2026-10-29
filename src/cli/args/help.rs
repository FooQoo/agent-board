//! The text printed by `agboard --help`.

/// `agboard --help`: the board workflow for agents.
pub(super) const TOP_HELP: &str = "\
agboard - a shared local work board for users and agents

Usage: agboard [--project NAME] [--json] <COMMAND>

Most board commands name a project with --project NAME. `progress` and `hook`
resolve the nearest registered folder binding when omitted; an explicit name
overrides that binding. The read-only `serve` command operates on the whole
data area.

Commands:
  project Create, list, rename, or delete projects
  init    Create the project's board, or empty an existing one
  add     Add a task to Todo
  edit    Change a task's title or description
  mv      Move a task to todo, doing, or done
  history Append a work note
  state   Report a task's run state: idle, running, or pending
  rm      Delete a task (humans only; asks for confirmation)
  ls      List tasks
  show    Show a task and its history
  epic    Create, list, show, edit, or delete epics and their documents
  attachment Add, list, or read image attachments
  snapshot Fetch the complete board and history
  progress Show active work in epic priority order
  hook    Add the current progress table to an agent hook
  wait    Wait for a board change or the next task
  workspace Show the project's shared folder and where its files are
  serve   Show the board in your browser (-d runs it in the background)
  stop    Stop the running server
  setup   Add the shared folder to Codex and Claude Code settings
  connect Install the Skill and Hook for Claude Code and Codex (interactive)
  update  Update the installed Skill and Hook to this version

Workflow for agents:
  agboard project ls --json
  agboard --project NAME workspace --json
  agboard progress --json
  agboard --project NAME progress --json
  agboard --project NAME ls --json
  agboard ls --all-projects --json
  agboard --project NAME mv <id> doing --actor ai --reason \"Start\"
  agboard --project NAME state <id> running --actor ai --reason \"Working\"
  agboard --project NAME state <id> pending --actor ai --request-json '{\"question\":\"Which plan?\",\"choices\":[{\"id\":\"a\",\"label\":\"Plan A\"},{\"id\":\"b\",\"label\":\"Plan B\"}]}'

Rules for agents:
  - Move a task to doing before you report running. A task in todo can ask a decision with pending.
  - Ask a decision with --request-json: a question and 2 to 10 choices. pending needs it.
  - Moving a task to todo or done resets it to idle.
  - You cannot delete tasks or projects, or replace a board. Ask a human to do it.
  - Get the shared folder from workspace --json; do not assume its location.
  - Do not edit TASK.md of a draft task, and do not edit task.json, epic.json,
    or project.json directly.
  - Do not delete task or epic folders; ask a human to do it.
  - Progress and hooks resolve the nearest registered project folder; --project overrides it.
  - Add --json to any command for machine-readable output.

Descriptions and drafts:
  - A description is Markdown, up to 50,000 characters. Give a long one with
    --desc-file PATH (or --desc - on standard input), not --desc TEXT.
  - Snapshots, `show`, and `wait` return descriptions in full. Progress and hooks
    return metadata only. If the hook's progress table exceeds 256 KiB, it reports AGBOARD_ERROR
    (context_too_large) instead; read only the needed EPIC.md and TASK.md files.
  - A task with \"isDraft\": true is a draft the user is still writing. It is
    read-only for you: `edit`, `mv`, and `state` fail with task_is_draft
    (exit code 1) and change nothing. Do not retry. Wait for the user to
    finalize it, and work on other tasks meanwhile. `add`, `show`, `ls`,
    `snapshot`, and `wait` still work.";
