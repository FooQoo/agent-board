//! `qa answer`: a person's answer, given in the chat or on the command line.

use serde_json::json;

use super::{Printed, answer_text, finish, input, invalid};
use crate::cli::args::{AnswerViaArg, QaAnswerArgs, read_reason};
use crate::cli::run::write_text;
use crate::cli::{Context, Env, errors, output};
use crate::error::AgboardError;
use crate::file_store::AnswerItem;
use crate::file_store::qa::{AnswerVia, QuestionStatus};

fn items(args: &QaAnswerArgs) -> Result<Vec<AnswerItem>, AgboardError> {
    let text = read_reason(args.text.as_deref(), args.text_file.as_deref())?;
    match (&args.answers_json, &args.question_id) {
        (Some(json), None) => {
            if args.choice.is_some() || text.is_some() {
                return Err(invalid(
                    "answer",
                    "--answers-json holds every answer; give no --choice or --text with it.",
                ));
            }
            input::answer_items(json)
        }
        (None, Some(id)) => Ok(vec![AnswerItem {
            question_id: id.clone(),
            choice_id: args.choice.clone(),
            text,
        }]),
        (Some(_), Some(_)) => Err(invalid(
            "answer",
            "Give a question ID or --answers-json, not both.",
        )),
        (None, None) => Err(invalid(
            "answer",
            "Name the question to answer, or give --answers-json.",
        )),
    }
}

pub(super) fn run(ctx: &mut Context, env: &mut Env, args: &QaAnswerArgs) -> i32 {
    let via = match args.via {
        AnswerViaArg::Chat => AnswerVia::Chat,
        AnswerViaArg::Cli => AnswerVia::Cli,
    };
    let prepared = (|| Ok::<_, AgboardError>((items(args)?, ctx.project_id()?.clone())))();
    let (items, project) = match prepared {
        Ok(found) => found,
        Err(error) => return refused(ctx, env, &error, None),
    };
    let result = ctx
        .files
        .answer_questions(&project, items.clone(), via, ctx.clock.now())
        .map_err(|error| (error, Some((project, items))));
    match result {
        Ok(questions) => {
            let human = questions
                .iter()
                .filter_map(|q| {
                    let a = q.answer.as_ref()?;
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
        Err((error, context)) => refused(ctx, env, &error, context),
    }
}

/// A refusal. When a question was answered first, the recorded answer is printed with the
/// error, so the agent can compare it with the answer it got in the chat.
fn refused(
    ctx: &Context,
    env: &mut Env,
    error: &AgboardError,
    context: Option<(crate::domain::ProjectId, Vec<AnswerItem>)>,
) -> i32 {
    let recorded: Vec<_> = match (error, &context) {
        (
            AgboardError::QuestionAnswered { .. } | AgboardError::QuestionWithdrawn { .. },
            Some((project, items)),
        ) => ctx
            .files
            .questions(project)
            .unwrap_or_default()
            .into_iter()
            .filter(|q| {
                q.status != QuestionStatus::Open && items.iter().any(|i| i.question_id == q.id)
            })
            .collect(),
        _ => Vec::new(),
    };
    let text = if ctx.json {
        let mut value = json!({"error": {
            "code": error.code(),
            "message": error.message(),
            "reason": error.reason(),
        }});
        if !recorded.is_empty() {
            value["questions"] = json!(recorded);
        }
        format!("{}\n", output::render_json(&value))
    } else {
        let mut text = errors::human(error);
        for q in &recorded {
            match &q.answer {
                Some(a) => text.push_str(&format!(
                    "Recorded answer of {}: {}\n",
                    q.id,
                    answer_text(a)
                )),
                None => text.push_str(&format!("{} was withdrawn.\n", q.id)),
            }
        }
        text
    };
    write_text(env.stderr, &text);
    error.exit_code()
}
