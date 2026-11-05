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
            "the pending request has changed.",
            "Read the latest board before answering this request.",
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
            "the choice is not part of this request.",
            "Choose one of the choices in the pending request.",
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
    ];
    let expected: Vec<(String, String)> = expected
        .into_iter()
        .map(|(m, r)| (m.to_string(), r.to_string()))
        .collect();
    assert_eq!(got, expected);
}
