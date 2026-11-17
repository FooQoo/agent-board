//! `message ask` and `message wait`: one event per line, from `registered` to the end of the wait.

use std::io::Write;

use serde_json::{Value, json};

use super::{answer_text, data_dir, input, notify};
use crate::agent::message_wait::{Heartbeat, MessageWaitEnd, read_questions, wait_for_questions};
use crate::cli::args::{MessageAskArgs, MessageWaitArgs};
use crate::cli::run::fail;
use crate::cli::{Context, Env, output};
use crate::error::AgboardError;
use crate::file_store::qa::{MessageState, Question, QuestionView};

/// The exit code of a wait that ran out of time; the questions stay open.
pub const EXIT_TIMEOUT: i32 = 5;
/// The exit code of a wait that ended with a withdrawn question.
pub const EXIT_WITHDRAWN: i32 = 6;

/// Writes the events, as JSON Lines or as English sentences.
struct Events<'a> {
    out: &'a mut dyn Write,
    json: bool,
}

fn ids_of(questions: &[Question]) -> Vec<&str> {
    questions.iter().map(|q| q.id.as_str()).collect()
}

/// The answers as the end events print them.
fn answers_of(questions: &[Question]) -> (Vec<Value>, Vec<String>) {
    let mut values = Vec::new();
    let mut lines = Vec::new();
    for question in questions {
        let view = QuestionView::of(question, Vec::new());
        let Some(reply) = &view.reply else { continue };
        values.push(json!({
            "id": view.id,
            "choiceId": reply.choice_id,
            "choiceLabel": reply.choice_label,
            "text": reply.text,
            "via": reply.via,
            "at": crate::clock::format_utc(reply.at),
        }));
        lines.push(format!("Answered {}: {}", view.id, answer_text(reply)));
    }
    (values, lines)
}

impl Events<'_> {
    fn line(&mut self, value: Value, human: String) {
        let text = if self.json {
            format!("{}\n", output::render_json(&value))
        } else {
            format!("{human}\n")
        };
        let _ = self.out.write_all(text.as_bytes());
        let _ = self.out.flush();
    }

    fn registered(&mut self, questions: &[Question], resumed: bool) {
        let ids = ids_of(questions);
        let listed: Vec<Value> = ids.iter().map(|id| json!({"id": id})).collect();
        let count = ids.len();
        let noun = if count == 1 { "question" } else { "questions" };
        let human = if resumed {
            format!("Waiting again for {}.", ids.join(", "))
        } else {
            format!("Asked {count} {noun}: {}.", ids.join(", "))
        };
        self.line(
            json!({"type": "registered", "questions": listed, "resumed": resumed}),
            human,
        );
    }

    fn waiting(&mut self, ids: &[String], beat: Heartbeat) {
        let left = match beat.remaining {
            Some(seconds) if seconds >= 60 => format!(", {}m left", seconds / 60),
            Some(seconds) => format!(", {seconds}s left"),
            None => String::new(),
        };
        self.line(
            json!({"type": "waiting", "ids": ids, "elapsed": beat.elapsed, "remaining": beat.remaining, "answered": beat.answered, "total": beat.total}),
            format!(
                "Waiting for answers: {} of {} answered{left}.",
                beat.answered, beat.total
            ),
        );
    }

    /// The last line; returns the exit code.
    fn end(&mut self, end: MessageWaitEnd) -> i32 {
        match end {
            MessageWaitEnd::Answered(questions) => {
                let (answers, lines) = answers_of(&questions);
                self.line(
                    json!({"type": "answered", "ids": ids_of(&questions), "answers": answers}),
                    lines.join("\n"),
                );
                0
            }
            MessageWaitEnd::Timeout(questions) => {
                let answered = questions
                    .iter()
                    .filter(|q| q.state() == MessageState::Closed)
                    .count();
                let total = questions.len();
                let open: Vec<&str> = questions
                    .iter()
                    .filter(|q| q.state() == MessageState::Open)
                    .map(|q| q.id.as_str())
                    .collect();
                self.line(
                    json!({"type": "timeout", "ids": ids_of(&questions), "answered": answered, "total": total}),
                    format!(
                        "Timed out: {answered} of {total} answered. The questions stay open; wait again with message wait {}.",
                        open.join(" ")
                    ),
                );
                EXIT_TIMEOUT
            }
            MessageWaitEnd::Withdrawn(questions) => {
                let withdrawn: Vec<&str> = questions
                    .iter()
                    .filter(|q| q.state() == MessageState::Withdrawn)
                    .map(|q| q.id.as_str())
                    .collect();
                let (answers, lines) = answers_of(&questions);
                let mut human = lines;
                human.push(format!("Withdrawn: {}.", withdrawn.join(", ")));
                self.line(
                    json!({"type": "withdrawn", "ids": withdrawn, "answers": answers}),
                    human.join("\n"),
                );
                EXIT_WITHDRAWN
            }
        }
    }

    /// A failure after the questions were asked: they stay.
    fn error(&mut self, error: &AgboardError, stderr: &mut dyn Write) -> i32 {
        if self.json {
            self.line(
                json!({"type": "error", "error": {"code": error.code(), "message": error.message(), "reason": error.reason()}}),
                String::new(),
            );
        } else {
            let _ = stderr.write_all(crate::cli::errors::human(error).as_bytes());
        }
        error.exit_code()
    }
}

/// A wait needs the server's event stream; it is checked before anything is
/// saved. When it is not running and starting is allowed, it is started now,
/// so a server that cannot start leaves no question behind. A server started
/// now opens the project's board.
fn ensure_serving(ctx: &Context) -> Result<(), AgboardError> {
    let dir = data_dir(ctx.files.shared_dir());
    if crate::autostart::enabled() {
        return crate::autostart::ensure_serving(&dir, Some(ctx.project_id()?)).map(|_| ());
    }
    let running =
        crate::paths::read_serve_info_in(&dir).is_some_and(|info| crate::server::is_serving(&info));
    if running {
        Ok(())
    } else {
        Err(AgboardError::BoardUnavailable {
            reason:
                "A wait needs a running server. Run \"agboard serve\" first, or ask with --no-wait."
                    .into(),
        })
    }
}

fn wait_and_print(
    ctx: &Context,
    env: &mut Env,
    ids: &[String],
    timeout: Option<u64>,
    heartbeat: u64,
) -> i32 {
    let project = match ctx.project_id() {
        Ok(project) => project.clone(),
        Err(error) => return fail(env, &error, ctx.json),
    };
    let mut events = Events {
        out: &mut *env.stdout,
        json: ctx.json,
    };
    let result = wait_for_questions(
        ctx.files.shared_dir(),
        project.clone(),
        ids,
        timeout,
        heartbeat,
        |beat| events.waiting(ids, beat),
    );
    let (code, handed) = match result {
        Ok(end) => {
            let handed = !matches!(end, MessageWaitEnd::Timeout(_));
            (events.end(end), handed)
        }
        Err(error) => return events.error(&error, &mut *env.stderr),
    };
    // The answers just printed are in the agent's hands: they leave the progress table and the
    // hook. A failure here loses nothing; the answers stay listed until they are accepted.
    if handed
        && let Ok(written) = ctx.files.accept_answers(&project, ids, ctx.clock.now())
        && !written.is_empty()
    {
        notify(ctx, env);
    }
    code
}

pub(super) fn ask(ctx: &mut Context, env: &mut Env, args: &MessageAskArgs) -> i32 {
    let prepared = (|| {
        let input = input::ask_input(&args.questions_json, args.actor.actor(), &args.tasks)?;
        let timeout = input::timeout(args.timeout.as_deref())?;
        if !args.no_wait {
            ensure_serving(ctx)?;
        }
        let project = ctx.project_id()?.clone();
        let questions = ctx.files.ask_questions(&project, input, ctx.clock.now())?;
        Ok::<_, AgboardError>((questions, timeout))
    })();
    let (questions, timeout) = match prepared {
        Ok(found) => found,
        Err(error) => return fail(env, &error, ctx.json),
    };
    Events {
        out: &mut *env.stdout,
        json: ctx.json,
    }
    .registered(&questions, false);
    // The page learns of the questions now, not after the answers.
    notify(ctx, env);
    if args.no_wait {
        return 0;
    }
    let ids: Vec<String> = questions.iter().map(|q| q.id.clone()).collect();
    wait_and_print(ctx, env, &ids, timeout, args.heartbeat)
}

pub(super) fn wait(ctx: &mut Context, env: &mut Env, args: &MessageWaitArgs) -> i32 {
    let prepared = (|| {
        let timeout = input::timeout(args.timeout.as_deref())?;
        let project = ctx.project_id()?.clone();
        let questions = read_questions(ctx.files.shared_dir(), &project, &args.ids)?;
        // Questions that have ended need no server.
        if questions.iter().any(|q| q.state() == MessageState::Open) {
            ensure_serving(ctx)?;
        }
        Ok::<_, AgboardError>((questions, timeout))
    })();
    let (questions, timeout) = match prepared {
        Ok(found) => found,
        Err(error) => return fail(env, &error, ctx.json),
    };
    Events {
        out: &mut *env.stdout,
        json: ctx.json,
    }
    .registered(&questions, true);
    wait_and_print(ctx, env, &args.ids, timeout, args.heartbeat)
}
