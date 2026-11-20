//! What happened on the board between two reads of a project, and which of it is worth a
//! notification.
//!
//! [`Facts`] is the part of a task that a notification can talk about. [`diff`] compares the
//! facts of one task before and after a change and names every event in between: a result
//! version that was not there, a question that is now open, a
//! history entry that was added. Each event has a key that names the occurrence (not the time
//! it was seen), so the same occurrence is the same key on every read, on every device, and
//! after a restart.

use std::collections::BTreeMap;

use crate::domain::ResultKind;
use crate::file_store::model::TaskView;
use crate::server::notification_settings::NotificationSettings;

/// What a task shows to a notification: the facts that change while work goes on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Facts {
    pub id: i64,
    pub title: String,
    /// The IDs of the questions that are open, lowest first.
    pub open_questions: Vec<String>,
    /// What the first open question asks.
    pub question: Option<String>,
    /// The results recorded, oldest first.
    pub results: Vec<ResultFact>,
    /// The history reasons, oldest first.
    pub history: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ResultFact {
    pub version: u32,
    pub kind: ResultKind,
    pub summary: String,
}

/// The facts of a task a notification may be sent about: not an archived card, not a draft
/// that nobody started, and not the guide's sample card.
pub(super) fn facts_of(task: &TaskView) -> Option<Facts> {
    if task.archived_at.is_some() || task.draft.is_some() || task.onboarding_sample.is_some() {
        return None;
    }
    Some(Facts {
        id: task.id,
        title: task.title.clone(),
        open_questions: task.open_question_ids.clone(),
        question: task.pending_reason.clone(),
        results: task
            .results
            .iter()
            .map(|r| ResultFact {
                version: r.version,
                kind: r.kind,
                summary: r.summary.clone(),
            })
            .collect(),
        history: task.history.iter().map(|h| h.reason.clone()).collect(),
    })
}

/// The kinds of event, most important first: a decision that is waiting beats a result, and a
/// result beats a history entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Kind {
    Question,
    Result(ResultKind),
    History,
}

impl Kind {
    /// Whether the saved settings switch this kind on.
    pub(super) fn wanted(self, settings: &NotificationSettings) -> bool {
        match self {
            Kind::Question => settings.kinds.questions,
            Kind::Result(_) => settings.kinds.results,
            Kind::History => settings.kinds.history,
        }
    }

    fn rank(self) -> u8 {
        match self {
            Kind::Question => 0,
            Kind::Result(_) => 1,
            Kind::History => 2,
        }
    }
}

/// One thing that happened to one task.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Event {
    pub project: String,
    pub task: i64,
    pub title: String,
    pub kind: Kind,
    /// Names the occurrence: the same for every read of it, different for every other event.
    pub key: String,
    /// The result version a result event is about.
    pub version: Option<u32>,
    /// The id (`Q-<n>`) of the question a question event is about.
    pub question_id: Option<String>,
    /// The summary, the question, or the history reason, as the board has it.
    pub detail: String,
}

impl Event {
    /// Lower is more important.
    pub(super) fn rank(&self) -> u8 {
        self.kind.rank()
    }
}

fn event(project: &str, now: &Facts, kind: Kind, key: String, detail: &str) -> Event {
    Event {
        project: project.to_string(),
        task: now.id,
        title: now.title.clone(),
        kind,
        key: format!("{key}:{project}:{}", now.id),
        version: None,
        question_id: None,
        detail: detail.to_string(),
    }
}

/// Every event between `before` and `now` for one task.
pub(super) fn diff_task(project: &str, before: &Facts, now: &Facts) -> Vec<Event> {
    let mut events = Vec::new();
    for result in &now.results {
        if before.results.iter().any(|r| r.version == result.version) {
            continue;
        }
        let mut e = event(
            project,
            now,
            Kind::Result(result.kind),
            format!("result:{}", result.version),
            &result.summary,
        );
        e.version = Some(result.version);
        events.push(e);
    }
    for id in &now.open_questions {
        if !before.open_questions.contains(id) {
            let text = now.question.as_deref().unwrap_or_default();
            let mut e = event(project, now, Kind::Question, format!("question:{id}"), text);
            e.question_id = Some(id.clone());
            events.push(e);
        }
    }
    if now.history.len() > before.history.len() {
        // One event for the entries added together; its key names the newest one.
        let last = now.history.len();
        let reason = now.history.last().map(String::as_str).unwrap_or_default();
        events.push(event(
            project,
            now,
            Kind::History,
            format!("history:{last}"),
            reason,
        ));
    }
    events
}

/// The tasks of a project, by ID.
pub(super) type ProjectFacts = BTreeMap<i64, Facts>;

pub(super) fn project_facts(tasks: &[TaskView]) -> ProjectFacts {
    tasks
        .iter()
        .filter_map(facts_of)
        .map(|facts| (facts.id, facts))
        .collect()
}

/// The events a project's change produced. A task that was not there before only starts
/// being followed: a card that is created does not announce itself.
pub(super) fn diff(project: &str, before: &ProjectFacts, now: &ProjectFacts) -> Vec<Event> {
    now.iter()
        .filter_map(|(id, facts)| before.get(id).map(|b| diff_task(project, b, facts)))
        .flatten()
        .collect()
}

/// What to send for the events of one change, given the saved settings: for each task the one
/// event that matters most among those whose kind is switched on, and the keys of every wanted
/// event of that task, so that the ones folded into it are never sent on their own later.
pub(super) fn choose(
    events: Vec<Event>,
    settings: &NotificationSettings,
) -> Vec<(Event, Vec<String>)> {
    let mut by_task: BTreeMap<(String, i64), Vec<Event>> = BTreeMap::new();
    for e in events.into_iter().filter(|e| e.kind.wanted(settings)) {
        by_task
            .entry((e.project.clone(), e.task))
            .or_default()
            .push(e);
    }
    by_task
        .into_values()
        .filter_map(|mut group| {
            let keys = group.iter().map(|e| e.key.clone()).collect();
            group.sort_by_key(|e| e.rank());
            group.into_iter().next().map(|winner| (winner, keys))
        })
        .collect()
}

#[cfg(test)]
mod tests;
