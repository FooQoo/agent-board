//! Every `agboard ...` command example in the documentation, the skill pages, the README,
//! and the `Examples:` sections of the help text parses with the real clap definition.
//! Nothing is executed: the words go to `try_get_matches_from` only.
//!
//! Prose may name a command without its arguments, so an inline span (not a code block, not the
//! help text) is allowed to stop short: see `fragment`.
//!
//! An example is skipped only when it is a template and not a command (see `placeholder`):
//! a `<...>` slot, a `[...]` optional part, an ellipsis, or an ALL-CAPS slot such as `NAME`.
//! The test prints how many examples it checked and how many it skipped, and fails when a
//! source yields none, so a broken extractor cannot pass silently.

use std::fs;
use std::path::{Path, PathBuf};

use agent_board::cli::args::Cli;
use clap::CommandFactory;
use clap::error::ErrorKind;

/// Directories searched for Markdown pages, and single files, relative to the repository.
const DIRS: &[&str] = &["docs/guide", "docs/dev", "src/skills"];
const FILES: &[&str] = &["README.md"];

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn markdown_files(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(dir).unwrap().flatten() {
        let path = entry.path();
        if path.is_dir() {
            markdown_files(&path, out);
        } else if path.extension().is_some_and(|e| e == "md") {
            out.push(path);
        }
    }
}

/// Split a command line into words the way a POSIX shell would, up to the first unquoted
/// control operator (`|`, `;`, `&`, or a redirect or comment at the start of a word). `None` when a quote is left open.
fn split_words(line: &str) -> Option<Vec<String>> {
    let (mut words, mut cur, mut has) = (Vec::new(), String::new(), false);
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\'' => {
                has = true;
                loop {
                    match chars.next()? {
                        '\'' => break,
                        ch => cur.push(ch),
                    }
                }
            }
            '"' => {
                has = true;
                loop {
                    match chars.next()? {
                        '"' => break,
                        '\\' => cur.push(chars.next()?),
                        ch => cur.push(ch),
                    }
                }
            }
            '\\' => {
                has = true;
                cur.push(chars.next()?);
            }
            '|' | ';' | '&' => break,
            // A redirect or a comment starts a word; `<id>` and `a#b` are plain words.
            '>' | '#' if !has => break,
            '<' if !has && matches!(chars.peek(), None | Some('<' | ' ' | '\'' | '"')) => break,
            c if c.is_whitespace() => {
                if has {
                    words.push(std::mem::take(&mut cur));
                    has = false;
                }
            }
            c => {
                has = true;
                cur.push(c);
            }
        }
    }
    if has {
        words.push(cur);
    }
    Some(words)
}

/// The words of an `agboard` command in `text`, after any `| ` or leading `NAME=value `.
fn command_words(text: &str) -> Option<Vec<String>> {
    let text = text.trim().trim_start_matches("$ ");
    let text = match text.rfind("| agboard ") {
        Some(at) => &text[at + 2..],
        None => text,
    };
    let mut words = split_words(text)?;
    while words
        .first()
        .is_some_and(|w| w.contains('=') && !w.starts_with('-'))
    {
        words.remove(0);
    }
    (words.first().map(String::as_str) == Some("agboard") && words.len() > 1).then_some(words)
}

/// Skip rule: the words are a template, not a command. A word with `<` and `>` (`<id>`), a
/// `[` or `]`, `...`/`…`, or one that is only capital letters, `_` and `-` (`NAME`,
/// `EPIC-ID`, `COUNT`, `X.Y.Z`) stands for something the reader fills in.
fn placeholder(words: &[String]) -> bool {
    words.iter().any(|w| {
        w.contains('<')
            || w.contains('>')
            || w.contains('[')
            || w.contains(']')
            || w.contains("...")
            || w.contains('…')
            || (w.len() > 1
                && !w.starts_with('-')
                && w.chars()
                    .all(|c| c.is_ascii_uppercase() || matches!(c, '_' | '-' | '.'))
                && w.chars().any(|c| c.is_ascii_uppercase()))
    })
}

/// An example and whether it came from prose (an inline code span) instead of a full command.
type Example = (String, bool);

/// Prose names a command or an option without its arguments (`agboard start`, `agboard edit
/// --title`). An inline span may therefore stop short of a complete command: a missing required
/// argument or subcommand, or a trailing option without its value. Anything else in it, such as
/// an unknown command or option, is still an error. Fenced blocks and help text are complete
/// commands and get no such allowance.
fn fragment(error: &clap::Error, words: &[String]) -> bool {
    match error.kind() {
        ErrorKind::MissingRequiredArgument
        | ErrorKind::DisplayHelpOnMissingArgumentOrSubcommand => true,
        ErrorKind::InvalidValue => words.last().is_some_and(|w| w.starts_with("--")),
        _ => false,
    }
}

/// Examples in one Markdown page: lines of fenced blocks that start with `agboard` (with
/// `\` continuations joined), and inline code spans that start with `agboard `.
fn page_examples(text: &str) -> Vec<Example> {
    let mut out = Vec::new();
    let (mut fenced, mut pending) = (false, String::new());
    for line in text.lines() {
        if line.trim_start().starts_with("```") {
            fenced = !fenced;
            pending.clear();
            continue;
        }
        if fenced {
            let line = line.trim();
            if !pending.is_empty() || command_words(line).is_some() || line.contains("| agboard ") {
                match line.strip_suffix('\\') {
                    Some(head) => {
                        pending.push_str(head);
                        pending.push(' ');
                    }
                    None => {
                        pending.push_str(line);
                        out.push((std::mem::take(&mut pending), false));
                    }
                }
            }
        } else {
            for (i, span) in line.split('`').enumerate() {
                if i % 2 == 1 && span.starts_with("agboard ") {
                    out.push((span.to_string(), true));
                }
            }
        }
    }
    out
}

/// Examples in the help text of every command: the `Examples:` lines of `after_help`.
fn help_examples() -> Vec<Example> {
    fn walk(cmd: &clap::Command, out: &mut Vec<Example>) {
        let texts = [cmd.get_after_help(), cmd.get_after_long_help()];
        for text in texts.into_iter().flatten() {
            for line in text.to_string().lines() {
                let line = line.trim();
                if command_words(line).is_some() {
                    out.push((line.to_string(), false));
                }
            }
        }
        for sub in cmd.get_subcommands() {
            walk(sub, out);
        }
    }
    let mut out = Vec::new();
    walk(&Cli::command(), &mut out);
    out
}

#[test]
fn documented_examples_parse() {
    let mut sources: Vec<(String, Vec<Example>)> = Vec::new();
    let mut files = Vec::new();
    for dir in DIRS {
        markdown_files(&root().join(dir), &mut files);
    }
    files.extend(FILES.iter().map(|f| root().join(f)));
    files.sort();
    for path in files {
        let text = fs::read_to_string(&path).unwrap();
        let name = path.strip_prefix(root()).unwrap().display().to_string();
        sources.push((name, page_examples(&text)));
    }
    sources.push(("help text".into(), help_examples()));

    let (mut checked, mut skipped, mut broken) = (0, 0, Vec::new());
    for (name, examples) in &sources {
        for (example, inline) in examples {
            let Some(words) = command_words(example) else {
                broken.push(format!(
                    "{name}: cannot split `{example}` into words (unbalanced quote?)"
                ));
                continue;
            };
            if placeholder(&words) {
                skipped += 1;
                continue;
            }
            checked += 1;
            match Cli::command().try_get_matches_from(&words) {
                Ok(_) => {}
                Err(e)
                    if matches!(e.kind(), ErrorKind::DisplayHelp | ErrorKind::DisplayVersion) => {}
                Err(e) if *inline && fragment(&e, &words) => {}
                Err(e) => broken.push(format!(
                    "{name}: `{}` does not parse: {}",
                    words.join(" "),
                    e.render().to_string().lines().next().unwrap_or_default()
                )),
            }
        }
    }
    eprintln!("docs examples: checked {checked}, skipped {skipped} placeholders");
    for (name, examples) in &sources {
        if name == "help text" {
            assert!(!examples.is_empty(), "no examples found in the help text");
        }
    }
    assert!(
        checked >= 100,
        "only {checked} examples were checked; the extractor looks broken"
    );
    assert!(
        broken.is_empty(),
        "\n{}\n\nFix the example, or the command it documents. A template with a slot is skipped only when it uses `<...>`, `[...]`, `...`, or an ALL-CAPS word.\n",
        broken.join("\n")
    );
}
