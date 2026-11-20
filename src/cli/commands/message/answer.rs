//! `message answer`: a person's answer, given in the chat or on the command line.

use serde_json::json;

use super::{Printed, answer_text, finish};
use crate::cli::args::{AnswerViaArg, MessageAnswerArgs, read_reason};
use crate::cli::run::write_text;
use crate::cli::{Context, Env, errors, output};
use crate::error::AgboardError;
use crate::file_store::AnswerItem;
use crate::file_store::qa::{AnswerVia, QuestionStatus};

pub(super) fn run(ctx: &mut Context, env: &mut Env, args: &MessageAnswerArgs) -> i32 {
    let via = match args.via {
        AnswerViaArg::Chat => AnswerVia::Chat,
        AnswerViaArg::Cli => AnswerVia::Cli,
    };
    let prepared = (|| {
        let text = read_reason(args.text.as_deref(), args.text_file.as_deref())?;
        Ok::<_, AgboardError>((text, ctx.project_id()?.clone()))
    })();
    let (text, project) = match prepared {
        Ok(found) => found,
        Err(error) => return refused(ctx, env, &error, None),
    };
    let item = AnswerItem {
        question_id: args.id.clone(),
        choice_id: args.choice.clone(),
        text,
        images: Vec::new(),
    };
    match ctx
        .files
        .answer_questions(&project, vec![item], via, ctx.clock.now())
    {
        Ok(questions) => {
            let human = questions
                .iter()
                .filter_map(|q| {
                    let a = q.reply.as_ref()?;
                    Some(format!("Answered {}: {}\n", q.id, answer_text(a)))
                })
                .collect();
            finish(
                ctx,
                env,
                Printed {
                    changed: true,
                    human,
                    json: json!({"questions": questions}),
                },
            )
        }
        Err(error) => refused(ctx, env, &error, Some((project, args.id.clone()))),
    }
}

/// A refusal. When the question was answered or withdrawn first, the recorded state is
/// printed with the error, so the agent can compare it with the answer it got in the chat.
fn refused(
    ctx: &Context,
    env: &mut Env,
    error: &AgboardError,
    context: Option<(crate::domain::ProjectId, String)>,
) -> i32 {
    let recorded = match (error, &context) {
        (
            AgboardError::QuestionAnswered { .. } | AgboardError::QuestionWithdrawn { .. },
            Some((project, id)),
        ) => ctx.files.question(project, id).ok(),
        _ => None,
    };
    let text = if ctx.json {
        let mut value = json!({"error": {
            "code": error.code(),
            "message": error.message(),
            "reason": error.reason(),
        }});
        if let Some(question) = &recorded {
            value["questions"] = json!([question]);
        }
        format!("{}\n", output::render_json(&value))
    } else {
        let mut text = errors::human(error);
        if let Some(q) = &recorded {
            match (&q.reply, q.status) {
                (Some(a), _) => text.push_str(&format!(
                    "Recorded answer of {}: {}\n",
                    q.id,
                    answer_text(a)
                )),
                (None, QuestionStatus::Withdrawn) => {
                    text.push_str(&format!("{} was withdrawn.\n", q.id));
                }
                (None, _) => {}
            }
        }
        text
    };
    write_text(env.stderr, &text);
    error.exit_code()
}
