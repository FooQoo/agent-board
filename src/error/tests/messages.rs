use super::*;

#[test]
fn messages_and_reasons_follow_the_design_table() {
    let got: Vec<(String, String)> = all_errors()
        .iter()
        .map(|e| (e.message(), e.reason()))
        .collect();
    let expected: Vec<(&str, &str)> = vec![
        (
            "project not found.",
            "No project matches \"Alpha\". Run \"agboard project ls\" to see the projects.",
        ),
        (
            "project \"Alpha\" already exists.",
            "Project names must be unique. Choose another name.",
        ),
        (
            "task #7 not found.",
            "No task has ID 7. Run \"agboard ls\" to see the tasks.",
        ),
        (
            "unexpected argument '--x'",
            "Run \"agboard add --help\" for usage.",
        ),
        ("title is invalid.", "r"),
        (
            "cannot set #11 to running.",
            "Only tasks in Doing can be running or pending. #11 is in Todo.",
        ),
        (
            "state is invalid for this assignee.",
            "Only AI-owned tasks in Doing can be running or pending.",
        ),
        (
            "task #5 is a draft and read-only for agents.",
            "Wait for the user to finalize it, then try again.",
        ),
        (
            "epic E is a draft and read-only for the CLI.",
            "Wait for the user to finalize it, then try again.",
        ),
        (
            "task #5 is an AI draft; a person starts it instead.",
            "Start the task (or its epic) instead of finalizing it.",
        ),
        (
            "start is for a person only.",
            "Ask the user to do this in the web UI or run it with --actor human.",
        ),
        (
            "task #5 is done and read-only for agents.",
            "A person must move the task out of Done before you can change it.",
        ),
        (
            "task #5 has unmet acceptance conditions: AC-2.",
            "Mark each condition done once it is verified, or ask a person to move the task.",
        ),
        (
            "task #5 is not a draft.",
            "Only a draft can be saved or finalized this way. #5 is not a draft.",
        ),
        (
            "cannot make #6 a draft while it is running.",
            "Only tasks whose agent status is idle can become drafts. #6 is not idle.",
        ),
        (
            "task #5 waits for answers to its questions.",
            "Wait for the answers with \"agboard message wait\", or see the questions with \"agboard message ls --task ID\".",
        ),
        (
            "Q-1 already answered.",
            "The first recorded answer is kept. Compare it with the answer you have, and ask again if they differ.",
        ),
        (
            "Q-2 withdrawn.",
            "A withdrawn question takes no answer. Ask a new question if one is still needed.",
        ),
        (
            "message Q-3 not found.",
            "Run \"agboard message ls --status all\" to see the messages of the project.",
        ),
        (
            "message Q-3 already has its reply.",
            "The message already has its reply; there is nothing to withdraw.",
        ),
        ("Q-3 is not a request.", "Name a request for this command."),
        (
            "request Q-4 was already accepted.",
            "Another agent accepted this request first. Leave it to that agent.",
        ),
        (
            "request Q-4 was withdrawn.",
            "The person withdrew this request. Nothing is written to a withdrawn request.",
        ),
        (
            "withdrawing a question is for an agent only.",
            "An agent does this with --actor ai; a person has no way to do it.",
        ),
        (
            "task #5 is now done.",
            "Another change moved the task first. Check its current status and move it again.",
        ),
        (
            "deleting a task needs confirmation from a human.",
            "Run this command yourself in a terminal. Agents cannot delete tasks or projects, or replace a board.",
        ),
        (
            "cannot read a.json.",
            "No such file or directory (os error 2)",
        ),
        (
            "projects/p/tasks/1/task.json is not valid.",
            "title: Titles must be 1 to 100 characters on one line.",
        ),
        (
            "cannot read projects/p/project.json.",
            "Permission denied (os error 13)",
        ),
        (
            "workspace.json has an unsupported format version.",
            "Only formatVersion 1 is supported, found 2. The file is not converted.",
        ),
        (
            "the choice is not part of this question.",
            "Choose one of the choices of the question.",
        ),
        (
            "the board is busy.",
            "Another agboard command is writing. Try again.",
        ),
        ("cannot open the board.", "boom"),
        (
            "the board is already being served.",
            "Open http://127.0.0.1:7420/ or stop the other \"agboard serve\".",
        ),
        (
            "port 7420 is already in use.",
            "Choose another port with --port.",
        ),
        (
            "local network connections are not allowed.",
            "This environment does not allow local network connections, so the Agent Board server cannot be started or reached. In Codex, run \"agboard setup\" to allow agboard to run outside the sandbox.",
        ),
        ("the board is unavailable.", "no running server"),
        ("the cursor is invalid.", "wrong project"),
        (
            "no board change before the timeout.",
            "Nothing changed in the project. This is not an answer; read the snapshot before acting.",
        ),
        (
            "the document path is invalid.",
            "Paths are relative and use /.",
        ),
        (
            "document a/b.md not found.",
            "No such file in the project's Docs. Choose a file from the tree.",
        ),
        (
            "a.txt is not a Markdown file.",
            "Only files ending in .md or .mdx can be opened.",
        ),
        (
            "a.md is too large.",
            "Files larger than 2097152 bytes cannot be opened here.",
        ),
        (
            "a.md is not UTF-8 text.",
            "Only UTF-8 text can be opened here. The file is not changed.",
        ),
        (
            "a.svg is not a supported image.",
            "Only PNG, JPEG, WebP, GIF, AVIF and SVG images are served.",
        ),
        (
            "this document operation is not available yet.",
            "The Docs API is still being built. Try again in a later version.",
        ),
        ("cannot open the Docs folder.", "xdg-open is not installed"),
        (
            "the ngrok connection is not available.",
            "No server is running.",
        ),
        (
            "cannot open the browser.",
            "Cannot start xdg-open: No such file or directory (os error 2). Open http://127.0.0.1:7420/?project=0123456789abcdef0123456789abcdef in your browser yourself.",
        ),
    ];
    let expected: Vec<(String, String)> = expected
        .into_iter()
        .map(|(m, r)| (m.to_string(), r.to_string()))
        .collect();
    assert_eq!(got, expected);
}

#[test]
fn port_in_use_names_what_holds_the_port() {
    let board = AgboardError::PortInUse {
        port: 7420,
        holder: crate::error::PortHolder::AgentBoard { pid: 41235 },
    };
    assert_eq!(
        board.reason(),
        "Port 7420 is used by another Agent Board server (pid 41235) with a different data folder. Choose another port with --port."
    );
    let other = AgboardError::PortInUse {
        port: 7420,
        holder: crate::error::PortHolder::OtherProgram,
    };
    assert_eq!(
        other.reason(),
        "Port 7420 is used by another program. Choose another port with --port."
    );
}

#[test]
fn already_serving_says_when_the_server_was_started_automatically() {
    let auto = AgboardError::AlreadyServing {
        port: 52114,
        auto: true,
    };
    assert!(
        auto.reason().contains("started automatically"),
        "{}",
        auto.reason()
    );
    assert!(
        auto.reason().contains("agboard serve -d"),
        "{}",
        auto.reason()
    );
}
