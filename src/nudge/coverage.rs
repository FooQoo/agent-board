//! The coverage table: every `agboard` command and every top-level field of
//! the progress table, mapped to the rules that watch what it creates, or to
//! `NoRule` with the reason none is needed.
//!
//! The tests below fail when you add a command or a progress field and leave
//! this table alone. That is the prompt to ask: does the new feature create
//! something an agent could forget? If so, add a rule to the registry
//! (`rules.rs`); if not, record `NoRule` with a reason.

use clap::CommandFactory;

use super::RULES;
use crate::cli::args::Cli;
use crate::progress::{ProgressAnswer, ProgressRequest};

/// What watches a command or a field.
pub enum Cover {
    /// These rules (ids of the registry).
    Rules(&'static [&'static str]),
    /// None, with the reason. `planned: #NNN` names the task that adds one.
    NoRule(&'static str),
}

use Cover::{NoRule, Rules};

const READ_ONLY: Cover = NoRule("read-only");

/// Commands as the path of subcommands (`message ask`). A command with
/// subcommands is covered through them.
pub const COMMANDS: &[(&str, Cover)] = &[
    ("add", NoRule("creates a Todo task; nothing to record yet")),
    ("attachment add", Rules(&["question-images"])),
    ("attachment get", READ_ONLY),
    ("attachment ls", READ_ONLY),
    ("edit", Rules(&["conditions-after-merge"])),
    (
        "epic add",
        NoRule("a person plans epics; nothing to forget"),
    ),
    (
        "epic edit",
        NoRule("a person plans epics; nothing to forget"),
    ),
    ("epic ls", READ_ONLY),
    (
        "epic rm",
        NoRule("a person removes epics; nothing to forget"),
    ),
    ("epic show", READ_ONLY),
    (
        "epic start",
        NoRule("a person plans epics; nothing to forget"),
    ),
    (
        "epic send",
        NoRule("a person plans epics; nothing to forget"),
    ),
    ("history add", Rules(&["history"])),
    ("hook", NoRule("the hook itself; it runs the rules")),
    ("init", NoRule("one-time board setup")),
    ("ls", READ_ONLY),
    ("message accept", Rules(&["answer", "request"])),
    ("message answer", Rules(&["question"])),
    (
        "message ask",
        Rules(&[
            "question",
            "question-images",
            "question-in-chat",
            "question-wait",
        ]),
    ),
    (
        "message link",
        NoRule("links a message to a task; nothing to forget"),
    ),
    ("message ls", READ_ONLY),
    (
        "message send",
        NoRule("a one-way notice; nothing to follow up"),
    ),
    ("message show", READ_ONLY),
    (
        "message unlink",
        NoRule("unlinks a message from a task; nothing to forget"),
    ),
    ("message wait", Rules(&["question-wait"])),
    (
        "message withdraw",
        NoRule("closes a question; nothing to forget"),
    ),
    ("mv", Rules(&["history", "start-task"])),
    ("open", NoRule("opens the board in a browser")),
    ("progress", READ_ONLY),
    ("project bind", NoRule("project administration by a person")),
    (
        "project create",
        NoRule("project administration by a person"),
    ),
    ("project ls", READ_ONLY),
    (
        "project rename",
        NoRule("project administration by a person"),
    ),
    ("project rm", NoRule("project administration by a person")),
    (
        "result add",
        Rules(&["final-result", "result-pr", "result-artifact"]),
    ),
    ("result ls", READ_ONLY),
    ("rm", NoRule("humans only; a person confirms it")),
    ("serve", NoRule("runs the server")),
    ("setup", NoRule("installation by a person")),
    ("setup remote", NoRule("installation by a person")),
    ("show", READ_ONLY),
    ("show remote", READ_ONLY),
    ("skills", READ_ONLY),
    ("snapshot", READ_ONLY),
    ("start", Rules(&["start-task"])),
    ("send", Rules(&["start-task"])),
    ("state", Rules(&["stale-running"])),
    ("stop", NoRule("pauses the server by a person's choice")),
    ("update", NoRule("installation by a person")),
    ("wait", NoRule("the listener itself; it waits by design")),
    ("workspace", NoRule("sets up the folder a person works in")),
];

/// Top-level fields of the progress JSON.
pub const FIELDS: &[(&str, Cover)] = &[
    ("answers", Rules(&["answer"])),
    ("cursor", NoRule("metadata")),
    ("done", NoRule("read-only list of recent Done tasks")),
    ("epics", Rules(&["conditions", "stale-running"])),
    ("epicsToClose", Rules(&["epic-close"])),
    ("fetchedAt", NoRule("metadata")),
    ("finalResultMissing", Rules(&["final-result"])),
    ("locale", NoRule("metadata")),
    ("nextTasks", Rules(&["next-task"])),
    (
        "pending",
        NoRule("read-only list of tasks waiting for a decision"),
    ),
    ("project", NoRule("metadata")),
    ("reminders", NoRule("the output of the state rules")),
    ("requests", Rules(&["request"])),
    ("unassigned", Rules(&["conditions", "stale-running"])),
    ("version", NoRule("metadata")),
];

const HELP: &str = "Decide whether the new feature creates something an agent could forget (a question to ask, a record to write, a state to leave right). If it does, add a rule to the registry in src/nudge/rules.rs with its cases in src/nudge/cases.rs. If not, record `NoRule(\"reason\")` for it in src/nudge/coverage.rs. See \"Add a rule\" in docs/dev/concepts/agents.md.";

/// The paths of every command without subcommands, from the clap definition.
fn command_paths() -> Vec<String> {
    fn walk(cmd: &clap::Command, prefix: &str, out: &mut Vec<String>) {
        let subs: Vec<_> = cmd.get_subcommands().collect();
        if subs.is_empty() || !cmd.is_subcommand_required_set() {
            out.push(prefix.trim().to_string());
        }
        for sub in subs {
            walk(sub, &format!("{prefix} {}", sub.get_name()), out);
        }
    }
    let mut out = Vec::new();
    for sub in Cli::command().get_subcommands() {
        walk(sub, sub.get_name(), &mut out);
    }
    out.sort();
    out
}

/// The top-level fields of a progress table with every optional field set.
fn field_names() -> Vec<String> {
    let mut table = super::test_support::progress_with(true, &[1]);
    table.locale = Some("ja".into());
    let at = chrono::Utc::now();
    table.requests.push(ProgressRequest {
        id: "R-1".into(),
        created_at: at,
        title: "t".into(),
    });
    table.answers.push(ProgressAnswer {
        id: "Q-1".into(),
        title: "t".into(),
        tasks: vec![1],
        choice_id: None,
        choice_label: None,
        text: None,
        answered_at: at,
        image_paths: Vec::new(),
    });
    table.reminders = super::state_reminders(&table, at);
    table.epics_to_close.push(crate::progress::EpicToClose {
        id: "E".into(),
        name: "E".into(),
        document_path: "p".into(),
    });
    table.pending = Some(Vec::new());
    table.done = Some(Vec::new());
    let mut names: Vec<String> = serde_json::to_value(&table)
        .unwrap()
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect();
    names.sort();
    names
}

/// The names that are missing from `table` and the table's names that no longer
/// exist.
fn diff(actual: &[String], table: &[(&str, Cover)]) -> (Vec<String>, Vec<String>) {
    let missing = actual
        .iter()
        .filter(|a| !table.iter().any(|(n, _)| n == a))
        .cloned()
        .collect();
    let stale = table
        .iter()
        .filter(|(n, _)| !actual.iter().any(|a| a == n))
        .map(|(n, _)| n.to_string())
        .collect();
    (missing, stale)
}

fn check(what: &str, actual: &[String], table: &[(&str, Cover)]) {
    let (missing, stale) = diff(actual, table);
    assert!(
        missing.is_empty() && stale.is_empty(),
        "The coverage table of {what} is out of date.\n  not in the table: {missing:?}\n  in the table but gone: {stale:?}\n{HELP}"
    );
}

#[test]
fn every_command_is_in_the_coverage_table() {
    check("agboard commands", &command_paths(), COMMANDS);
}

#[test]
fn every_progress_field_is_in_the_coverage_table() {
    check("progress fields", &field_names(), FIELDS);
}

#[test]
fn the_coverage_table_names_real_rules_and_reasons() {
    for (name, cover) in COMMANDS.iter().chain(FIELDS) {
        match cover {
            Rules(ids) => {
                assert!(
                    !ids.is_empty(),
                    "`{name}` lists no rule; use NoRule(reason)"
                );
                for id in *ids {
                    assert!(
                        RULES.iter().any(|r| r.id == *id),
                        "`{name}` names rule `{id}`, which is not in the registry"
                    );
                }
            }
            NoRule(reason) => assert!(!reason.trim().is_empty(), "`{name}` has an empty reason"),
        }
    }
}

#[test]
fn the_failure_message_tells_the_developer_what_to_do() {
    let actual = vec!["brand new".to_string()];
    let (missing, stale) = diff(&actual, &[("old", NoRule("x"))]);
    assert_eq!(missing, ["brand new"]);
    assert_eq!(stale, ["old"]);
    assert!(HELP.contains("add a rule") && HELP.contains("NoRule") && HELP.contains("agents.md"));
}
