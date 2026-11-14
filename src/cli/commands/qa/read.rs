//! `qa ls`, `qa show`, `qa withdraw`, `qa link`, and `qa unlink`.

use serde_json::json;

use super::{Printed, answer_text, head};
use crate::cli::Context;
use crate::cli::args::{QaLinkArgs, QaLsArgs, QaShowArgs, QaStatusArg, QaWithdrawArgs};
use crate::error::AgboardError;
use crate::file_store::qa::{QuestionStatus, QuestionView};

fn referenced(question: &QuestionView) -> String {
    if question.referenced_by.is_empty() {
        "-".into()
    } else {
        question
            .referenced_by
            .iter()
            .map(|id| format!("#{id}"))
            .collect::<Vec<_>>()
            .join(", ")
    }
}

pub(super) fn list(ctx: &Context, args: &QaLsArgs) -> Result<Printed, AgboardError> {
    let wanted = match args.status {
        QaStatusArg::Open => Some(QuestionStatus::Open),
        QaStatusArg::Answered => Some(QuestionStatus::Answered),
        QaStatusArg::Withdrawn => Some(QuestionStatus::Withdrawn),
        QaStatusArg::All => None,
    };
    let questions: Vec<QuestionView> = ctx
        .files
        .questions(ctx.project_id()?)?
        .into_iter()
        .filter(|q| wanted.is_none_or(|s| q.status == s))
        .filter(|q| args.task.is_none_or(|id| q.referenced_by.contains(&id)))
        .collect();
    let human = if questions.is_empty() {
        "No questions.\n".to_string()
    } else {
        questions
            .iter()
            .map(|q| {
                format!(
                    "{}  {}  {}  {}  {}\n",
                    q.id,
                    q.kind.as_str(),
                    q.status.as_str(),
                    head(q, 60),
                    referenced(q)
                )
            })
            .collect()
    };
    Ok(Printed {
        changed: false,
        human,
        json: json!({"questions": questions}),
    })
}

fn describe(q: &QuestionView) -> String {
    let mut text = format!(
        "{} ({}, {}) in request {}\n{}\n",
        q.id,
        q.kind.as_str(),
        q.status.as_str(),
        q.request_id,
        q.question
    );
    for choice in &q.choices {
        let mark = if q.recommended_choice_id.as_deref() == Some(choice.id.as_str()) {
            " (recommended)"
        } else {
            ""
        };
        text.push_str(&format!("  {}: {}{mark}\n", choice.id, choice.label));
    }
    if let Some(answer) = &q.answer {
        text.push_str(&format!(
            "Answer ({}): {}\n",
            answer.via.as_str(),
            answer_text(answer)
        ));
    }
    text.push_str(&format!("Referenced by: {}\n", referenced(q)));
    text
}

pub(super) fn show(ctx: &Context, args: &QaShowArgs) -> Result<Printed, AgboardError> {
    let project = ctx.project_id()?;
    if args.id.starts_with("Q-") {
        let question = ctx.files.question(project, &args.id)?;
        return Ok(Printed {
            changed: false,
            human: describe(&question),
            json: json!({"question": question}),
        });
    }
    let (request, questions) = ctx.files.request(project, &args.id)?;
    let mut human = format!(
        "Request {} ({}), {} of {} answered\n",
        request.request_id,
        serde_json::to_value(request.status())
            .ok()
            .and_then(|v| v.as_str().map(str::to_string))
            .unwrap_or_default(),
        request.answered_count(),
        request.questions.len()
    );
    for q in &questions {
        human.push('\n');
        human.push_str(&describe(q));
    }
    Ok(Printed {
        changed: false,
        human,
        json: json!({
            "request": {
                "requestId": request.request_id,
                "status": request.status(),
                "createdAt": crate::clock::format_utc(request.created_at),
                "createdBy": request.created_by,
                "withdrawnAt": request.withdrawn_at.map(crate::clock::format_utc),
                "withdrawReason": request.withdraw_reason,
            },
            "questions": questions,
        }),
    })
}

pub(super) fn withdraw(ctx: &Context, args: &QaWithdrawArgs) -> Result<Printed, AgboardError> {
    let project = ctx.project_id()?;
    let request = ctx.files.withdraw_request(
        project,
        &args.request_id,
        args.actor.actor(),
        args.reason.as_deref(),
        ctx.clock.now(),
    )?;
    Ok(Printed {
        changed: true,
        human: format!("Withdrew request {}.\n", request.request_id),
        json: json!({
            "requestId": request.request_id,
            "withdrawnAt": request.withdrawn_at.map(crate::clock::format_utc),
            "withdrawReason": request.withdraw_reason,
        }),
    })
}

pub(super) fn link(ctx: &Context, args: &QaLinkArgs, add: bool) -> Result<Printed, AgboardError> {
    let project = ctx.project_id()?;
    let task = ctx.files.link_questions(
        project,
        args.task,
        &args.ids,
        add,
        args.actor.actor(),
        ctx.clock.now(),
    )?;
    let listed = if task.question_ids.is_empty() {
        "no questions".to_string()
    } else {
        task.question_ids.join(", ")
    };
    Ok(Printed {
        changed: true,
        human: format!("#{} refers to {listed}.\n", task.id),
        json: json!({"task": task}),
    })
}
