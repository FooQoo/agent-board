//! `message ls`, `show`, `withdraw`, `link`, and `unlink`.

use serde_json::json;

use super::{Printed, answer_text, head};
use crate::cli::Context;
use crate::cli::args::{
    MessageLinkArgs, MessageLsArgs, MessageShowArgs, MessageStatusArg, MessageTypeArg,
    MessageWithdrawArgs,
};
use crate::error::AgboardError;
use crate::file_store::qa::{MessageView, QuestionView, RequestView};

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

pub(super) fn list(ctx: &Context, args: &MessageLsArgs) -> Result<Printed, AgboardError> {
    let wanted = match args.status {
        MessageStatusArg::Open => Some("open"),
        MessageStatusArg::Closed => Some("closed"),
        MessageStatusArg::Withdrawn => Some("withdrawn"),
        MessageStatusArg::All => None,
    };
    let messages: Vec<MessageView> = ctx
        .files
        .messages(ctx.project_id()?)?
        .into_iter()
        .filter(|m| wanted.is_none_or(|s| m.state() == s))
        .filter(|m| {
            matches!(
                (args.kind, m),
                (None, _)
                    | (Some(MessageTypeArg::Question), MessageView::Question(_))
                    | (Some(MessageTypeArg::Request), MessageView::Request(_))
            )
        })
        .filter(|m| match (args.task, m) {
            (None, _) => true,
            (Some(id), MessageView::Question(q)) => q.referenced_by.contains(&id),
            (Some(_), MessageView::Request(_)) => false,
        })
        .collect();
    let human = if messages.is_empty() {
        "No messages.\n".to_string()
    } else {
        messages
            .iter()
            .map(|m| match m {
                MessageView::Question(q) => format!(
                    "{}  question  {}  {}  {}\n",
                    q.id,
                    q.status.as_str(),
                    head(&q.body, 60),
                    referenced(q)
                ),
                MessageView::Request(r) => format!(
                    "{}  request  {}  {}  -\n",
                    r.id,
                    r.status.as_str(),
                    head(&r.body, 60)
                ),
            })
            .collect()
    };
    Ok(Printed {
        changed: false,
        human,
        json: json!({"messages": messages}),
    })
}

fn describe_question(q: &QuestionView) -> String {
    let mut text = format!("{} (question, {})\n{}\n", q.id, q.status.as_str(), q.body);
    for choice in &q.choices {
        let mark = if q.recommended_choice_id.as_deref() == Some(choice.id.as_str()) {
            " (recommended)"
        } else {
            ""
        };
        text.push_str(&format!("  {}: {}{mark}\n", choice.id, choice.label));
    }
    if let Some(reply) = &q.reply {
        text.push_str(&format!(
            "Answer ({}): {}\n",
            reply.via.as_str(),
            answer_text(reply)
        ));
    }
    text.push_str(&format!("Referenced by: {}\n", referenced(q)));
    text
}

fn describe_request(r: &RequestView) -> String {
    let mut text = format!("{} (request, {})\n{}\n", r.id, r.status.as_str(), r.body);
    if let (Some(at), Some(by)) = (r.accepted_at, &r.accepted_by) {
        text.push_str(&format!(
            "Accepted by {by} at {}\n",
            crate::clock::format_utc(at)
        ));
    }
    text
}

pub(super) fn show(ctx: &Context, args: &MessageShowArgs) -> Result<Printed, AgboardError> {
    let project = ctx.project_id()?;
    Ok(match ctx.files.message(project, &args.id)? {
        MessageView::Question(question) => Printed {
            changed: false,
            human: describe_question(&question),
            json: json!({"question": question}),
        },
        MessageView::Request(request) => Printed {
            changed: false,
            human: describe_request(&request),
            json: json!({"request": request}),
        },
    })
}

pub(super) fn withdraw(ctx: &Context, args: &MessageWithdrawArgs) -> Result<Printed, AgboardError> {
    let project = ctx.project_id()?;
    let changed =
        ctx.files
            .withdraw_message(project, &args.id, args.actor.actor(), ctx.clock.now())?;
    let (kind, json) = match &changed.value {
        MessageView::Question(q) => ("question", json!({"question": q})),
        MessageView::Request(r) => ("request", json!({"request": r})),
    };
    Ok(Printed {
        changed: changed.changed,
        human: format!("Withdrew {kind} {}.\n", args.id),
        json,
    })
}

pub(super) fn link(
    ctx: &Context,
    args: &MessageLinkArgs,
    add: bool,
) -> Result<Printed, AgboardError> {
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
