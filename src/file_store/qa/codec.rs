//! Reading and writing `QA.md`: YAML frontmatter, then the Markdown body.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_yaml_ng::Value;

use super::model::{AnswerVia, Message, Question, Reply, Request};
use crate::domain::Actor;
use crate::file_store::frontmatter::{Split, read_yaml, split};
use crate::file_store::model::Choice;
use crate::file_store::validate::Defect;

fn defect(field: &str, reason: impl Into<String>) -> Defect {
    Defect {
        field: field.into(),
        reason: reason.into(),
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ReplyFront {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    choice: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    via: AnswerVia,
    #[serde(with = "crate::clock::serde_utc")]
    at: DateTime<Utc>,
    #[serde(
        default,
        with = "crate::clock::serde_opt_utc",
        skip_serializing_if = "Option::is_none"
    )]
    accepted_at: Option<DateTime<Utc>>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct QuestionFront {
    from: Actor,
    to: Actor,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    tasks: Vec<i64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    choices: Vec<Choice>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    recommended: Option<String>,
    #[serde(default)]
    reply: Option<ReplyFront>,
    #[serde(default, with = "crate::clock::serde_opt_utc")]
    withdrawn_at: Option<DateTime<Utc>>,
    #[serde(with = "crate::clock::serde_utc")]
    created_at: DateTime<Utc>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RequestFront {
    from: Actor,
    to: Actor,
    #[serde(default, with = "crate::clock::serde_opt_utc")]
    accepted_at: Option<DateTime<Utc>>,
    #[serde(default, with = "crate::clock::serde_opt_utc")]
    withdrawn_at: Option<DateTime<Utc>>,
    #[serde(with = "crate::clock::serde_utc")]
    created_at: DateTime<Utc>,
}

fn invalid(error: impl std::fmt::Display) -> Defect {
    defect(
        "frontmatter",
        format!("The frontmatter is not valid: {error}."),
    )
}

/// Read a `QA.md` whose folder is `id`. Only the shape is checked here; the rules are in
/// `check_message`.
pub fn parse_message(id: &str, text: &str) -> Result<Message, Defect> {
    let text = text.replace("\r\n", "\n");
    let Split::Found { yaml, body } = split(&text) else {
        return Err(defect(
            "frontmatter",
            "QA.md starts with a frontmatter between two --- lines.",
        ));
    };
    let value = read_yaml(yaml)?;
    let from = match &value {
        Value::Mapping(map) => map.get("from").and_then(Value::as_str),
        _ => None,
    };
    let body = body.trim().to_string();
    match from {
        Some("ai") => {
            let f: QuestionFront = serde_yaml_ng::from_value(value).map_err(invalid)?;
            if f.to != Actor::Human {
                return Err(defect("to", "A question is sent to a person."));
            }
            Ok(Message::Question(Question {
                id: id.to_string(),
                body,
                tasks: f.tasks,
                choices: f.choices,
                recommended: f.recommended,
                reply: f.reply.map(|r| Reply {
                    choice: r.choice,
                    text: r.text,
                    via: r.via,
                    at: r.at,
                    accepted_at: r.accepted_at,
                }),
                withdrawn_at: f.withdrawn_at,
                created_at: f.created_at,
            }))
        }
        Some("human") => {
            let f: RequestFront = serde_yaml_ng::from_value(value).map_err(invalid)?;
            if f.to != Actor::Ai {
                return Err(defect("to", "A request is sent to an agent."));
            }
            Ok(Message::Request(Request {
                id: id.to_string(),
                body,
                accepted_at: f.accepted_at,
                withdrawn_at: f.withdrawn_at,
                created_at: f.created_at,
            }))
        }
        _ => Err(defect(
            "from",
            "from is ai (a question) or human (a request).",
        )),
    }
}

/// The text of a message's `QA.md`.
pub fn render_message(message: &Message) -> Result<String, Defect> {
    let (yaml, body) = match message {
        Message::Question(q) => (
            serde_yaml_ng::to_string(&QuestionFront {
                from: Actor::Ai,
                to: Actor::Human,
                tasks: q.tasks.clone(),
                choices: q.choices.clone(),
                recommended: q.recommended.clone(),
                reply: q.reply.as_ref().map(|r| ReplyFront {
                    choice: r.choice.clone(),
                    text: r.text.clone(),
                    via: r.via,
                    at: r.at,
                    accepted_at: r.accepted_at,
                }),
                withdrawn_at: q.withdrawn_at,
                created_at: q.created_at,
            }),
            &q.body,
        ),
        Message::Request(r) => (
            serde_yaml_ng::to_string(&RequestFront {
                from: Actor::Human,
                to: Actor::Ai,
                accepted_at: r.accepted_at,
                withdrawn_at: r.withdrawn_at,
                created_at: r.created_at,
            }),
            &r.body,
        ),
    };
    let yaml = yaml.map_err(|e| defect("frontmatter", format!("It cannot be written: {e}.")))?;
    Ok(format!("---\n{yaml}---\n\n{}\n", body.trim_end()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::parse_utc;

    #[test]
    fn a_question_round_trips() {
        let text = "---\nfrom: ai\nto: human\ntasks: [21, 22]\nchoices:\n  - { id: keep, label: 残す }\n  - { id: delete, label: 消す }\nrecommended: keep\nreply: null\nwithdrawnAt: null\ncreatedAt: 2026-11-17T09:00:00Z\n---\n既存のデータを残しますか。\n\n![いまの画面](attachments/current.png)\n";
        let Message::Question(q) = parse_message("Q-7", text).unwrap() else {
            panic!("a question");
        };
        assert_eq!(q.tasks, vec![21, 22]);
        assert_eq!(q.choices.len(), 2);
        assert_eq!(q.recommended.as_deref(), Some("keep"));
        assert!(q.reply.is_none() && q.withdrawn_at.is_none());
        assert_eq!(q.created_at, parse_utc("2026-11-17T09:00:00Z").unwrap());
        assert!(q.body.starts_with("既存のデータ") && q.body.ends_with("current.png)"));
        let written = render_message(&Message::Question(q.clone())).unwrap();
        assert!(written.contains("reply: null"));
        assert!(written.contains("withdrawnAt: null"));
        assert_eq!(
            parse_message("Q-7", &written).unwrap(),
            Message::Question(q)
        );
    }

    #[test]
    fn a_reply_and_a_request_round_trip() {
        let at = parse_utc("2026-11-17T10:00:00Z").unwrap();
        let q = Question {
            id: "Q-1".into(),
            body: "Which?".into(),
            tasks: vec![],
            choices: vec![],
            recommended: None,
            reply: Some(Reply {
                choice: None,
                text: Some("The smaller one.".into()),
                via: AnswerVia::Cli,
                at,
                accepted_at: Some(at),
            }),
            withdrawn_at: None,
            created_at: at,
        };
        let written = render_message(&Message::Question(q.clone())).unwrap();
        assert!(written.contains("via: cli") && !written.contains("choice:"));
        assert_eq!(
            parse_message("Q-1", &written).unwrap(),
            Message::Question(q)
        );

        let r = Request {
            id: "Q-2".into(),
            body: "Add a link.".into(),
            accepted_at: Some(at),
            withdrawn_at: None,
            created_at: at,
        };
        let written = render_message(&Message::Request(r.clone())).unwrap();
        assert_eq!(parse_message("Q-2", &written).unwrap(), Message::Request(r));
    }

    #[test]
    fn unknown_keys_and_missing_frontmatter_are_defects() {
        assert!(parse_message("Q-1", "Just text").is_err());
        let text =
            "---\nfrom: ai\nto: human\nkind: plan\ncreatedAt: 2026-11-17T09:00:00Z\n---\nX\n";
        assert!(parse_message("Q-1", text).is_err());
    }
}
