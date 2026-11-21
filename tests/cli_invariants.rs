//! Rules for how the clap definition may consume arguments, checked over the whole command
//! tree. Two bugs came from argument settings that swallowed the next flag
//! (`epic edit --waves 1 2 --json`, `--reason --json`). A rule that fails names the command
//! and the argument; fix the definition, or add an entry to the matching allowlist with a
//! reason a reviewer can weigh.

use agent_board::cli::args::Cli;
use clap::error::ErrorKind;
use clap::{Arg, Command, CommandFactory};

/// An allowlist entry: the command path (`"epic edit"`), the argument id, and why it is safe.
type Allow = (&'static str, &'static str, &'static str);

/// Arguments that may use `allow_hyphen_values` or `allow_negative_numbers`.
const HYPHEN_VALUES: &[Allow] = &[];

/// Arguments that may use `trailing_var_arg` or `last(true)`.
const TRAILING: &[Allow] = &[];

/// Arguments that may take more than one value (`num_args` max above 1). Each one is
/// reviewed: its values must be bare words that never start with `-`.
const MULTI_VALUE: &[Allow] = &[
    (
        "epic edit",
        "waves",
        "one word per wave (task IDs joined by commas); hyphen values are off, so a later flag ends the list",
    ),
    (
        "message wait",
        "ids",
        "positional question IDs; hyphen values are off, so a later flag ends the list",
    ),
    (
        "message link",
        "ids",
        "positional question IDs; hyphen values are off, so a later flag ends the list",
    ),
    (
        "message unlink",
        "ids",
        "positional question IDs; hyphen values are off, so a later flag ends the list",
    ),
];

/// Arguments that split one value on a delimiter.
const DELIMITED: &[Allow] = &[];

/// Every command in the tree with its path, the root first (empty path).
fn commands() -> Vec<(Vec<String>, Command)> {
    fn walk(cmd: &Command, path: Vec<String>, out: &mut Vec<(Vec<String>, Command)>) {
        out.push((path.clone(), cmd.clone()));
        for sub in cmd.get_subcommands() {
            let mut next = path.clone();
            next.push(sub.get_name().to_string());
            walk(sub, next, out);
        }
    }
    let mut out = Vec::new();
    let mut root = Cli::command();
    root.build();
    walk(&root, Vec::new(), &mut out);
    out
}

fn allowed(list: &[Allow], path: &str, id: &str) -> bool {
    list.iter().any(|(p, a, reason)| {
        assert!(
            !reason.trim().is_empty(),
            "allowlist entry {p} {a} needs a reason"
        );
        *p == path && *a == id
    })
}

/// Collect a message for every argument of the tree that `broken` flags and `list` does not allow.
fn check(rule: &str, list: &[Allow], fix: &str, broken: impl Fn(&Arg) -> bool) -> Vec<String> {
    let mut failures = Vec::new();
    for (path, cmd) in commands() {
        let path = path.join(" ");
        for arg in cmd.get_arguments() {
            let id = arg.get_id().as_str();
            if broken(arg) && !allowed(list, &path, id) {
                failures.push(format!(
                    "command `agboard {path}`, argument `{id}`: {rule}. {fix} Or add (\"{path}\", \"{id}\", \"<reason>\") to the allowlist in tests/cli_invariants.rs."
                ));
            }
        }
    }
    failures
}

fn assert_clean(failures: Vec<String>) {
    assert!(failures.is_empty(), "\n{}\n", failures.join("\n"));
}

#[test]
fn no_argument_consumes_flags_as_values() {
    assert_clean(check(
        "uses allow_hyphen_values or allow_negative_numbers, so it can take the next flag as its value",
        HYPHEN_VALUES,
        "Remove the setting; a text that starts with `-` is passed as --opt=- text, from a file, or from standard input.",
        |a| a.is_allow_hyphen_values_set() || a.is_allow_negative_numbers_set(),
    ));
}

#[test]
fn no_argument_trails_the_command_line() {
    assert_clean(check(
        "uses trailing_var_arg or last(true), so it takes every word after it",
        TRAILING,
        "Remove the setting and take explicit options instead.",
        |a| a.is_trailing_var_arg_set() || a.is_last_set(),
    ));
}

#[test]
fn multi_value_arguments_are_reviewed() {
    let multi = |a: &Arg| a.get_num_args().is_some_and(|range| range.max_values() > 1);
    // A multi-value argument must never also accept hyphen values.
    assert_clean(check(
        "takes several values and also allows hyphen values",
        &[],
        "Remove allow_hyphen_values; a multi-value option would swallow every later flag.",
        |a| multi(a) && (a.is_allow_hyphen_values_set() || a.is_allow_negative_numbers_set()),
    ));
    assert_clean(check(
        "takes more than one value (num_args max above 1)",
        MULTI_VALUE,
        "Prefer one value per option or a repeated option; if several values are needed, review that they never start with `-`.",
        multi,
    ));
}

#[test]
fn value_delimiters_are_reviewed() {
    assert_clean(check(
        "splits its value with value_delimiter",
        DELIMITED,
        "Use a repeated option unless one delimited word is clearly the better input.",
        |a| a.get_value_delimiter().is_some(),
    ));
}

#[test]
fn allowlists_name_real_arguments() {
    let all = commands();
    for (list, name) in [
        (HYPHEN_VALUES, "HYPHEN_VALUES"),
        (TRAILING, "TRAILING"),
        (MULTI_VALUE, "MULTI_VALUE"),
        (DELIMITED, "DELIMITED"),
    ] {
        for (path, id, _) in list {
            let found = all.iter().any(|(p, cmd)| {
                p.join(" ") == *path && cmd.get_arguments().any(|a| a.get_id() == *id)
            });
            assert!(
                found,
                "{name} lists `{path} {id}`, which is not in the command tree"
            );
        }
    }
}

/// The raw values the matches hold for `id`, looking through the subcommand chain.
fn raw_values(matches: &clap::ArgMatches, id: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = Some(matches);
    while let Some(m) = current {
        if let Ok(Some(raw)) = m.try_get_raw(id) {
            out.extend(raw.map(|v| v.to_string_lossy().into_owned()));
        }
        current = m.subcommand().map(|(_, sub)| sub);
    }
    out
}

#[test]
fn options_reject_the_next_flag_as_their_value() {
    let mut checked = 0;
    for (path, cmd) in commands() {
        for arg in cmd.get_arguments() {
            let Some(long) = arg.get_long() else { continue };
            if !arg.get_action().takes_values() || long == "json" {
                continue;
            }
            let mut argv = vec!["agboard".to_string()];
            argv.extend(path.iter().cloned());
            argv.push(format!("--{long}"));
            argv.push("--json".into());
            let line = argv.join(" ");
            match Cli::command().try_get_matches_from(&argv) {
                Ok(matches) => {
                    let values = raw_values(&matches, arg.get_id().as_str());
                    assert!(
                        !values.iter().any(|v| v == "--json"),
                        "`{line}` stored `--json` as the value of --{long}. Remove allow_hyphen_values or the multi-value setting from that argument."
                    );
                }
                Err(e) => assert_ne!(
                    e.kind(),
                    ErrorKind::MissingRequiredArgument,
                    "`{line}` skipped the value check: clap reported a missing required argument before it looked at --{long}"
                ),
            }
            checked += 1;
        }
    }
    assert!(
        checked > 20,
        "only {checked} options were checked; the walk looks broken"
    );
}
