//! `message`: asking the user, waiting for the answers, recording answers, and requests.
//!
//! Every subcommand prints its own output. `ask` and `wait` stream one event per line and end
//! with an exit code of their own: 0 answered, 5 timeout, 6 withdrawn.

mod answer;
mod input;
mod read;
mod request;
mod stream;

use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::cli::args::{Cli, MessageArgs, MessageCommand};
use crate::cli::run::{fail, write_text};
use crate::cli::{Context, Env, output};
use crate::error::AgboardError;
use crate::file_store::qa::ReplyView;

/// What a finished subcommand prints, and whether it changed the board.
pub(super) struct Printed {
    pub changed: bool,
    pub human: String,
    pub json: Value,
}

pub fn execute(cli: &Cli, env: &mut Env, args: &MessageArgs) -> i32 {
    let mut ctx = match crate::cli::run::prepare(cli, env) {
        Ok(ctx) => ctx,
        Err(error) => return fail(env, &error, cli.json),
    };
    if let Ok(project) = ctx.project_id() {
        crate::agent::session_touch::touch_from_env(&data_dir(ctx.files.shared_dir()), project);
    }
    let result = match &args.command {
        MessageCommand::Ask(ask) => return stream::ask(&mut ctx, env, ask),
        MessageCommand::Wait(wait) => return stream::wait(&mut ctx, env, wait),
        MessageCommand::Answer(answer) => return answer::run(&mut ctx, env, answer),
        MessageCommand::Ls(ls) => read::list(&ctx, ls),
        MessageCommand::Show(show) => read::show(&ctx, show),
        MessageCommand::Withdraw(withdraw) => read::withdraw(&ctx, withdraw),
        MessageCommand::Link(link) => read::link(&ctx, link, true),
        MessageCommand::Unlink(link) => read::link(&ctx, link, false),
        MessageCommand::Send(send) => request::send(&ctx, send),
        MessageCommand::Accept(accept) => request::accept(&ctx, accept),
    };
    match result {
        Ok(printed) => finish(&ctx, env, printed),
        Err(error) => fail(env, &error, cli.json),
    }
}

/// Print a finished subcommand and tell a running server about a change.
fn finish(ctx: &Context, env: &mut Env, printed: Printed) -> i32 {
    let text = if ctx.json {
        format!("{}\n", output::render_json(&printed.json))
    } else {
        printed.human
    };
    write_text(env.stdout, &text);
    if printed.changed {
        notify(ctx, env);
    }
    0
}

/// The data directory: the parent of the shared folder, where `serve.json` is.
fn data_dir(shared: &Path) -> PathBuf {
    shared
        .parent()
        .filter(|dir| !dir.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf()
}

fn notify(ctx: &Context, env: &mut Env) {
    let dir = data_dir(ctx.files.shared_dir());
    (env.after_commit)(ctx, &dir);
}

/// One reply as one line: `label — text`.
fn answer_text(reply: &ReplyView) -> String {
    match (&reply.choice_label, &reply.text) {
        (Some(label), Some(text)) => format!("{label} — {text}"),
        (Some(label), None) => label.clone(),
        (None, Some(text)) => text.clone(),
        (None, None) => String::new(),
    }
}

/// The first line of a text, cut to `limit` characters.
fn head(text: &str, limit: usize) -> String {
    let first = text.lines().next().unwrap_or_default();
    if first.chars().count() > limit {
        format!("{}…", first.chars().take(limit).collect::<String>())
    } else {
        first.to_string()
    }
}

fn invalid(command: &str, message: impl Into<String>) -> AgboardError {
    AgboardError::InvalidArgument {
        message: message.into(),
        command: Some(format!("message {command}")),
    }
}
