//! `qa ask` and `qa wait`: one event per line, from `registered` to the end of the wait.

use std::io::Write;

use serde_json::{Value, json};

use super::{answer_text, data_dir, input, notify};
use crate::agent::qa_wait::{Heartbeat, QaWaitEnd, wait_for_request};
use crate::cli::args::{QaAskArgs, QaWaitArgs};
use crate::cli::run::fail;
use crate::cli::{Context, Env, output};
use crate::error::AgboardError;
use crate::file_store::qa::QaRequestFile;

/// The exit code of a wait that ran out of time; the request stays open.
pub const EXIT_TIMEOUT: i32 = 5;
/// The exit code of a wait whose request was withdrawn.
pub const EXIT_WITHDRAWN: i32 = 6;

/// Writes the events, as JSON Lines or as English sentences.
struct Events<'a> {
    out: &'a mut dyn Write,
    json: bool,
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

    fn registered(&mut self, request: &QaRequestFile, resumed: bool) {
        let ids: Vec<&str> = request.questions.iter().map(|q| q.id.as_str()).collect();
        let questions: Vec<Value> = request
            .questions
            .iter()
            .map(|q| json!({"id": q.id, "kind": q.kind}))
            .collect();
        let count = request.questions.len();
        let noun = if count == 1 { "question" } else { "questions" };
        let human = if resumed {
            format!(
                "Waiting again for request {}: {}.",
                request.request_id,
                ids.join(", ")
            )
        } else {
            format!(
                "Registered {count} {noun} (request {}): {}.",
                request.request_id,
                ids.join(", ")
            )
        };
        self.line(
            json!({"type": "registered", "requestId": request.request_id, "questions": questions, "resumed": resumed}),
            human,
        );
    }

    fn waiting(&mut self, request_id: &str, beat: Heartbeat) {
        let left = match beat.remaining {
            Some(seconds) if seconds >= 60 => format!(", {}m left", seconds / 60),
            Some(seconds) => format!(", {seconds}s left"),
            None => String::new(),
        };
        self.line(
            json!({"type": "waiting", "requestId": request_id, "elapsed": beat.elapsed, "remaining": beat.remaining, "answered": beat.answered, "total": beat.total}),
            format!(
                "Waiting for answers: {} of {} answered{left}.",
                beat.answered, beat.total
            ),
        );
    }

    /// The last line; returns the exit code.
    fn end(&mut self, end: QaWaitEnd) -> i32 {
        match end {
            QaWaitEnd::Answered(request) => {
                let answers: Vec<Value> = request
                    .questions
                    .iter()
                    .filter_map(|q| {
                        let a = q.answer.as_ref()?;
                        Some(json!({"id": q.id, "choiceId": a.choice_id, "choiceLabel": a.choice_label, "text": a.text, "via": a.via, "at": crate::clock::format_utc(a.at)}))
                    })
                    .collect();
                let human = request
                    .questions
                    .iter()
                    .filter_map(|q| {
                        let a = q.answer.as_ref()?;
                        Some(format!("Answered {}: {}", q.id, answer_text(a)))
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                self.line(
                    json!({"type": "answered", "requestId": request.request_id, "answers": answers}),
                    human,
                );
                0
            }
            QaWaitEnd::Timeout(request) => {
                let answered = request.answered_count();
                let total = request.questions.len();
                self.line(
                    json!({"type": "timeout", "requestId": request.request_id, "answered": answered, "total": total}),
                    format!(
                        "Timed out: {answered} of {total} answered. The request stays open; wait again with qa wait {}.",
                        request.request_id
                    ),
                );
                EXIT_TIMEOUT
            }
            QaWaitEnd::Withdrawn(request) => {
                let reason = request.withdraw_reason.clone();
                let human = match &reason {
                    Some(reason) => {
                        format!("Request {} was withdrawn: {reason}", request.request_id)
                    }
                    None => format!("Request {} was withdrawn.", request.request_id),
                };
                self.line(
                    json!({"type": "withdrawn", "requestId": request.request_id, "reason": reason}),
                    human,
                );
                EXIT_WITHDRAWN
            }
        }
    }

    /// A failure after registration: the request stays.
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
/// so a server that cannot start leaves no question behind.
fn ensure_serving(ctx: &Context) -> Result<(), AgboardError> {
    let dir = data_dir(ctx.files.shared_dir());
    if crate::autostart::enabled() {
        return crate::autostart::ensure_serving(&dir).map(|_| ());
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
    request: &QaRequestFile,
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
    let result = wait_for_request(
        ctx.files.shared_dir(),
        project,
        &request.request_id,
        timeout,
        heartbeat,
        |beat| events.waiting(&request.request_id, beat),
    );
    match result {
        Ok(end) => events.end(end),
        Err(error) => events.error(&error, &mut *env.stderr),
    }
}

pub(super) fn ask(ctx: &mut Context, env: &mut Env, args: &QaAskArgs) -> i32 {
    let prepared = (|| {
        let input = input::ask_input(&args.request_json, args.actor.actor(), &args.tasks)?;
        let timeout = input::timeout(args.timeout.as_deref())?;
        if !args.no_wait {
            ensure_serving(ctx)?;
        }
        let project = ctx.project_id()?.clone();
        let request = ctx.files.ask_questions(&project, input, ctx.clock.now())?;
        Ok::<_, AgboardError>((request, timeout))
    })();
    let (request, timeout) = match prepared {
        Ok(found) => found,
        Err(error) => return fail(env, &error, ctx.json),
    };
    Events {
        out: &mut *env.stdout,
        json: ctx.json,
    }
    .registered(&request, false);
    // The page learns of the questions now, not after the answers.
    notify(ctx, env);
    if args.no_wait {
        return 0;
    }
    wait_and_print(ctx, env, &request, timeout, args.heartbeat)
}

pub(super) fn wait(ctx: &mut Context, env: &mut Env, args: &QaWaitArgs) -> i32 {
    let prepared = (|| {
        let timeout = input::timeout(args.timeout.as_deref())?;
        let project = ctx.project_id()?.clone();
        let (request, _) = ctx.files.request(&project, &args.request_id)?;
        // A request that has ended needs no server.
        if request.status() == crate::file_store::qa::RequestStatus::Open {
            ensure_serving(ctx)?;
        }
        Ok::<_, AgboardError>((request, timeout))
    })();
    let (request, timeout) = match prepared {
        Ok(found) => found,
        Err(error) => return fail(env, &error, ctx.json),
    };
    Events {
        out: &mut *env.stdout,
        json: ctx.json,
    }
    .registered(&request, true);
    wait_and_print(ctx, env, &request, timeout, args.heartbeat)
}
