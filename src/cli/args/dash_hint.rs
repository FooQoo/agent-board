//! The hint for a text value that starts with `-`.

use std::ffi::OsString;

use clap::CommandFactory;

use super::Cli;

/// A hint for a value that starts with `-` right after an option that takes
/// one, such as `--reason "- item"`: the parser sees an unknown flag. Options
/// do not accept a next word that starts with `-` as their value, so the value
/// must be joined with `=` or come from a file or standard input.
pub(super) fn dash_value_hint(error: &clap::Error, args: &[OsString]) -> Option<String> {
    use clap::error::{ContextKind, ContextValue, ErrorKind};
    if error.kind() != ErrorKind::UnknownArgument {
        return None;
    }
    let Some(ContextValue::String(token)) = error.get(ContextKind::InvalidArg) else {
        return None;
    };
    if !token.starts_with('-') {
        return None;
    }
    let words: Vec<&str> = args.iter().skip(1).filter_map(|a| a.to_str()).collect();
    let at = words
        .iter()
        .position(|word| word.starts_with(token.as_str()))?;
    let option = words.get(at.checked_sub(1)?)?;
    let name = option.strip_prefix("--").filter(|n| !n.contains('='))?;
    if !takes_value(&Cli::command(), name) {
        return None;
    }
    Some(format!(
        "If \"{token}\" is the value of --{name}, write --{name}=\"...\" with an equals sign, or pass the text from a file or from standard input (-) where the command offers one."
    ))
}

/// Whether some option named `--name` in the command tree takes a value.
fn takes_value(command: &clap::Command, name: &str) -> bool {
    command
        .get_arguments()
        .any(|arg| arg.get_long() == Some(name) && arg.get_action().takes_values())
        || command.get_subcommands().any(|sub| takes_value(sub, name))
}
