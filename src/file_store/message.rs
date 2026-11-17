//! Questions, requests and approvals in one shape.
//!
//! Lists, the band and notifications read only [`Message`]. What differs between the three
//! kinds stays inside their types: a [`Question`] and a [`Request`] come from a message file,
//! an [`Approval`] is derived from the AI drafts and has no file of its own.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::model::{EpicView, TaskView};
use super::qa::{QuestionStatus, QuestionView, RequestStatus, RequestView};
use super::reader::ProjectSnapshot;
use crate::domain::Draft;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageKind {
    Question,
    Request,
    Approval,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Party {
    Ai,
    Human,
}

/// One item of the common shape. `turn` is who has to act; `None` means it is over.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: MessageKind,
    pub from: Party,
    pub to: Party,
    pub turn: Option<Party>,
    /// The first line of a message, or the name of the epic or task of an approval.
    pub title: String,
    pub created_at: String,
    pub tasks: Vec<i64>,
    pub epic_id: Option<String>,
}

/// What the three kinds have in common.
pub trait MessageSource {
    fn message(&self) -> Message;
}

/// The first non-empty line of a text without Markdown heading marks, up to 200 characters.
pub fn title_of(body: &str) -> String {
    let line = body.lines().map(str::trim).find(|l| !l.is_empty());
    let line = line
        .unwrap_or_default()
        .trim_start_matches('#')
        .trim_start();
    line.chars().take(200).collect()
}

pub struct Question<'a>(pub &'a QuestionView);
pub struct Request<'a>(pub &'a RequestView);

/// A plan the agent proposed and a person has not started yet: an epic (id = the epic's ID,
/// `tasks` = its AI drafts) or a single task with no epic (id = `#<task id>`).
pub struct Approval {
    id: String,
    title: String,
    created_at: String,
    tasks: Vec<i64>,
    epic_id: Option<String>,
}

impl MessageSource for Question<'_> {
    fn message(&self) -> Message {
        let q = self.0;
        Message {
            id: q.id.clone(),
            kind: MessageKind::Question,
            from: Party::Ai,
            to: Party::Human,
            // An answer stays listed as the agent's turn until an agent accepts it.
            turn: match q.status {
                QuestionStatus::Open => Some(Party::Human),
                QuestionStatus::Answered
                    if q.reply.as_ref().is_some_and(|r| r.accepted_at.is_none()) =>
                {
                    Some(Party::Ai)
                }
                _ => None,
            },
            title: title_of(&q.body),
            created_at: crate::clock::format_utc(q.created_at),
            tasks: q.tasks.clone(),
            epic_id: None,
        }
    }
}

impl MessageSource for Request<'_> {
    fn message(&self) -> Message {
        let r = self.0;
        Message {
            id: r.id.clone(),
            kind: MessageKind::Request,
            from: Party::Human,
            to: Party::Ai,
            turn: (r.status == RequestStatus::Open).then_some(Party::Ai),
            title: title_of(&r.body),
            created_at: crate::clock::format_utc(r.created_at),
            tasks: Vec::new(),
            epic_id: None,
        }
    }
}

impl MessageSource for Approval {
    fn message(&self) -> Message {
        Message {
            id: self.id.clone(),
            kind: MessageKind::Approval,
            from: Party::Ai,
            to: Party::Human,
            turn: Some(Party::Human),
            title: self.title.clone(),
            created_at: self.created_at.clone(),
            tasks: self.tasks.clone(),
            epic_id: self.epic_id.clone(),
        }
    }
}

/// The approvals of a project: every epic that is an AI draft, every epic that has AI-draft
/// tasks (one approval per epic), and every AI-draft task outside an epic.
pub fn approvals(epics: &[EpicView], tasks: &[TaskView]) -> Vec<Approval> {
    let mut by_epic: BTreeMap<&str, Vec<&TaskView>> = BTreeMap::new();
    let mut alone = Vec::new();
    for task in tasks
        .iter()
        .filter(|t| t.draft == Some(Draft::Ai) && t.archived_at.is_none())
    {
        match task.epic_id.as_deref() {
            Some(id) if epics.iter().any(|e| e.id.as_str() == id) => {
                by_epic.entry(id).or_default().push(task)
            }
            _ => alone.push(task),
        }
    }
    let mut out = Vec::new();
    for epic in epics {
        let members = by_epic.remove(epic.id.as_str()).unwrap_or_default();
        if epic.draft != Some(Draft::Ai) && members.is_empty() {
            continue;
        }
        let created = if epic.draft == Some(Draft::Ai) {
            epic.created_at
        } else {
            members
                .iter()
                .map(|t| t.created_at)
                .min()
                .unwrap_or(epic.created_at)
        };
        let mut ids: Vec<i64> = members.iter().map(|t| t.id).collect();
        ids.sort_unstable();
        out.push(Approval {
            id: epic.id.to_string(),
            title: epic.name.clone(),
            created_at: crate::clock::format_utc(created),
            tasks: ids,
            epic_id: Some(epic.id.to_string()),
        });
    }
    out.extend(alone.into_iter().map(|task| Approval {
        id: format!("#{}", task.id),
        title: task.title.clone(),
        created_at: crate::clock::format_utc(task.created_at),
        tasks: vec![task.id],
        epic_id: None,
    }));
    out
}

/// The open messages of a project, oldest first (ties by ID). Accepted and withdrawn messages
/// are left out: nothing is waiting on them, and no screen lists them. An answer no agent
/// accepted yet stays, as the agent's turn.
pub fn messages(snapshot: &ProjectSnapshot) -> Vec<Message> {
    let mut all: Vec<Message> = snapshot
        .questions
        .iter()
        .map(|q| Question(q).message())
        .chain(snapshot.requests.iter().map(|r| Request(r).message()))
        .chain(
            approvals(&snapshot.epics, &snapshot.tasks)
                .iter()
                .map(MessageSource::message),
        )
        .filter(|e| e.turn.is_some())
        .collect();
    all.sort_by(|a, b| (&a.created_at, &a.id).cmp(&(&b.created_at, &b.id)));
    all
}
