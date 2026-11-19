//! The text printed by `agboard --help`.

/// `agboard --help`: the board workflow for agents.
pub(super) const TOP_HELP: &str = "\
agboard - a shared local work board for users and agents

Usage: agboard [--project NAME] [--json] <COMMAND>

Most board commands name a project with --project NAME. `progress`, `open`,
and `hook` resolve the nearest registered folder binding when omitted; an
explicit name overrides that binding. The read-only `serve` command operates
on the whole data area.

Commands:
  project Create, list, rename, or delete projects
  init    Create the project's board, or empty an existing one
  add     Add a task to Todo
  edit    Change a task's title or description
  mv      Move a task to todo, doing, or done
  history Append a work note
  state   Report a task's run state: idle or running
  message Ask the user questions, wait for the answers, and handle requests from the user
  rm      Delete a task (humans only; asks for confirmation)
  ls      List tasks
  show    Show a task and its history
  epic    Create, list, show, edit, or delete epics and their documents
  attachment Add, list, or read image attachments
  result     Record results for the requester, or list them
  snapshot Fetch the complete board and history
  progress Show active work in epic priority order
  hook    Add the current progress table to an agent hook
  skills  Print the instructions of the agent-board Skill
  wait    Wait for a board change or the next task
  workspace Show the project's shared folder and where its files are
  serve   Show the board in your browser (-d runs it in the background)
  open    Open the project's board in your browser
  remote  Show the ngrok state, public URL, and passcode for the phone
  stop    Stop the running server
  setup   Install the Agent Board plugin for Codex and Claude Code
  update  Update the installed Agent Board plugin to this version

Workflow for agents:
  agboard project ls --json
  agboard --project NAME workspace --json
  agboard progress --json
  agboard --project NAME progress --json
  agboard --project NAME ls --json
  agboard ls --all-projects --json
  agboard --project NAME remote --json
  agboard --project NAME mv <id> doing --actor ai --reason \"Start\"
  agboard --project NAME state <id> running --actor ai --reason \"Working\"
  agboard --project NAME message ask --actor ai --task <id> --json --questions-json '{\"questions\":[{\"body\":\"Which plan?\",\"choices\":[{\"id\":\"a\",\"label\":\"Plan A\"},{\"id\":\"b\",\"label\":\"Plan B\"}]}]}'

Rules for agents:
  - Move a task to doing before you report running.
  - Ask the user with message ask: 1 to 20 questions, each with 2 to 10 choices
    or none (then the answer is words). Each question is its own message. The
    tasks named with --task wait until the questions are answered.
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
  - `edit` replaces the body and acceptance conditions only. The stored history and
    question references stay; `history` and `questions` in the input are ignored.
  - Snapshots, `show`, and `wait` return descriptions in full. Progress and hooks
    return metadata only. If the hook's progress table exceeds 256 KiB, it reports AGBOARD_ERROR
    (context_too_large) instead; read only the needed EPIC.md and TASK.md files.
  - A task with \"draft\": \"human\" is a draft the user is still writing. It is
    read-only for you: `edit`, `mv`, `state`, and `history add` fail with
    task_is_draft (exit code 1) and change nothing. Do not retry. Wait for the
    user to finalize it, and work on other tasks meanwhile.
  - Every task and epic you create is an AI draft (\"draft\": \"ai\"), also when it
    is for the user. You can `edit` it and add `history`; `mv` and `state` fail
    with task_is_draft. Ask what you cannot settle with `message ask`, write the
    answers into the plan, then start it yourself (`start`, `epic start`). An open
    question on the task refuses the start with start_blocked_by_questions. `add`,
    `show`, `ls`, `snapshot`, and `wait` still work.";
