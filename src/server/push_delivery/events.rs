//! What happened on the board between two reads of a project, and which of it is worth a
//! notification.
//!
//! [`Facts`] is the part of a task that a notification can talk about. [`diff`] compares the
//! facts of one task before and after a change and names every event in between: a result
//! version that was not there, a question that is now open, a state the card moved into, a
//! history entry that was added. Each event has a key that names the occurrence (not the time
//! it was seen), so the same occurrence is the same key on every read, on every device, and
//! after a restart.

use std::collections::BTreeMap;

use crate::domain::{Column, ResultKind, RunState};
use crate::file_store::model::TaskView;
use crate::server::notification_settings::{NotificationSettings, StateChange};

/// What a task shows to a notification: the facts that change while work goes on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Facts {
    pub id: i64,
    pub title: String,
    pub status: Column,
    pub run: RunState,
    /// The IDs of the questions that are open, lowest first.
    pub open_questions: Vec<String>,
    /// What the first open question asks.
    pub question: Option<String>,
    /// The results recorded, oldest first.
    pub results: Vec<ResultFact>,
    /// The history reasons, oldest first.
    pub history: Vec<String>,
    /// Every record on the card, a history entry or a result, oldest first.
    pub records: Vec<Record>,
    /// When the card last changed column, run state, and anything, in Unix seconds.
    pub status_changed_at: i64,
    pub run_changed_at: i64,
    pub updated_at: i64,
}

/// One record on a card: when it was written (Unix seconds) and what it says.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Record {
    pub at: i64,
    pub text: String,
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
        status: task.task_status,
        run: task.agent_status,
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
        records: records_of(task),
        status_changed_at: task.task_status_changed_at.timestamp(),
        run_changed_at: task.agent_status_changed_at.timestamp(),
        updated_at: task.updated_at.timestamp(),
    })
}

fn records_of(task: &TaskView) -> Vec<Record> {
    let history = task.history.iter().map(|h| (h.at, &h.reason));
    let results = task.results.iter().map(|r| (r.at, &r.summary));
    let mut records: Vec<Record> = history
        .chain(results)
        .map(|(at, text)| Record {
            at: at.timestamp(),
            text: text.clone(),
        })
        .collect();
    records.sort_by_key(|r| r.at);
    records
}

/// The kinds of event, most important first: a decision that is waiting beats a result, a
/// result beats a state change, and a state change beats a history entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Kind {
    Question,
    Result(ResultKind),
    State(StateChange),
    History,
}

impl Kind {
    /// Whether the saved settings switch this kind on.
    pub(super) fn wanted(self, settings: &NotificationSettings) -> bool {
        match self {
            Kind::Question => settings.kinds.questions,
            Kind::Result(_) => settings.kinds.results,
            Kind::State(change) => settings.wants_state_change(change),
            Kind::History => settings.kinds.history,
        }
    }

    fn rank(self) -> u8 {
        match self {
            Kind::Question => 0,
            Kind::Result(_) => 1,
            Kind::State(StateChange::Done) => 2,
            Kind::State(StateChange::Pending) => 3,
            Kind::State(StateChange::Started) => 4,
            Kind::History => 5,
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
            events.push(event(
                project,
                now,
                Kind::Question,
                format!("question:{id}"),
                text,
            ));
        }
    }
    if before.status != Column::Done && now.status == Column::Done {
        let key = format!("state:done:{}", now.status_changed_at);
        events.push(event(project, now, Kind::State(StateChange::Done), key, ""));
    }
    if before.status != Column::Doing && now.status == Column::Doing {
        let key = format!("state:started:{}", now.status_changed_at);
        events.push(event(
            project,
            now,
            Kind::State(StateChange::Started),
            key,
            "",
        ));
    }
    if before.run != RunState::Pending && now.run == RunState::Pending {
        let key = format!("state:pending:{}", now.updated_at);
        events.push(event(
            project,
            now,
            Kind::State(StateChange::Pending),
            key,
            "",
        ));
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
