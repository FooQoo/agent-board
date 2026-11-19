use super::*;
use crate::domain::{Column, ResultKind, RunState};
use crate::server::notification_settings::NotificationSettings;

const PROJECT: &str = "0123456789abcdef0123456789abcdef";

fn card(id: i64) -> Facts {
    Facts {
        id,
        title: format!("Card {id}"),
        status: Column::Doing,
        run: RunState::Running,
        open_questions: Vec::new(),
        question: None,
        results: Vec::new(),
        history: Vec::new(),
        records: Vec::new(),
        status_changed_at: 1_000,
        run_changed_at: 1_000,
        updated_at: 1_000,
    }
}

fn result(version: u32, kind: ResultKind) -> ResultFact {
    ResultFact {
        version,
        kind,
        summary: format!("summary {version}"),
    }
}

fn settings(f: impl FnOnce(&mut NotificationSettings)) -> NotificationSettings {
    let mut s = NotificationSettings::default();
    f(&mut s);
    s
}

#[test]
fn a_new_result_version_is_an_event_named_by_its_version() {
    let before = card(7);
    let mut now = card(7);
    now.results.push(result(1, ResultKind::Progress));
    let events = diff_task(PROJECT, &before, &now);
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].kind, Kind::Result(ResultKind::Progress));
    assert_eq!(events[0].key, format!("result:1:{PROJECT}:7"));
    assert_eq!(events[0].version, Some(1));
    // Reading the same board again finds nothing new.
    assert!(diff_task(PROJECT, &now, &now).is_empty());
}

#[test]
fn defaults_send_a_result_but_not_a_state_change() {
    let before = card(7);
    let mut moved = card(7);
    moved.status = Column::Done;
    moved.status_changed_at = 2_000;
    let events = diff_task(PROJECT, &before, &moved);
    assert_eq!(events.len(), 1);
    assert!(choose(events, &NotificationSettings::default()).is_empty());

    let mut with_result = card(7);
    with_result.results.push(result(1, ResultKind::Progress));
    let events = diff_task(PROJECT, &before, &with_result);
    assert_eq!(choose(events, &NotificationSettings::default()).len(), 1);
}

#[test]
fn a_kind_that_is_off_sends_nothing() {
    let before = card(7);
    let mut now = card(7);
    now.results.push(result(1, ResultKind::Final));
    let events = diff_task(PROJECT, &before, &now);
    let off = settings(|s| s.kinds.results = false);
    assert!(choose(events, &off).is_empty());
}

#[test]
fn state_changes_follow_the_chosen_transitions() {
    let before = card(7);
    let mut done = card(7);
    done.status = Column::Done;
    done.status_changed_at = 2_000;
    let events = diff_task(PROJECT, &before, &done);
    let only_started = settings(|s| {
        s.kinds.state_changes = true;
        s.state_changes.done = false;
    });
    assert!(choose(events.clone(), &only_started).is_empty());
    let with_done = settings(|s| s.kinds.state_changes = true);
    let chosen = choose(events, &with_done);
    assert_eq!(chosen.len(), 1);
    assert_eq!(chosen[0].0.kind, Kind::State(StateChange::Done));

    let mut todo = card(8);
    todo.status = Column::Todo;
    let mut started = card(8);
    started.status = Column::Doing;
    started.status_changed_at = 3_000;
    let events = diff_task(PROJECT, &todo, &started);
    assert_eq!(events[0].kind, Kind::State(StateChange::Started));
    assert_eq!(events[0].key, format!("state:started:3000:{PROJECT}:8"));

    let mut waiting = card(8);
    waiting.run = RunState::Pending;
    waiting.updated_at = 4_000;
    let events = diff_task(PROJECT, &started, &waiting);
    assert_eq!(events[0].kind, Kind::State(StateChange::Pending));
}

#[test]
fn a_new_open_question_and_a_new_history_entry_are_events() {
    let before = card(7);
    let mut now = card(7);
    now.open_questions.push("q-2".to_string());
    now.question = Some("Which one?".to_string());
    now.history.push("Checked the layout".to_string());
    let events = diff_task(PROJECT, &before, &now);
    let kinds: Vec<Kind> = events.iter().map(|e| e.kind).collect();
    assert!(kinds.contains(&Kind::Question) && kinds.contains(&Kind::History));
    let question = events.iter().find(|e| e.kind == Kind::Question).unwrap();
    assert_eq!(question.key, format!("question:q-2:{PROJECT}:7"));
    assert_eq!(question.detail, "Which one?");
    let history = events.iter().find(|e| e.kind == Kind::History).unwrap();
    assert_eq!(history.key, format!("history:1:{PROJECT}:7"));
    assert_eq!(history.detail, "Checked the layout");
}

#[test]
fn several_events_of_one_task_become_one_with_the_question_first() {
    let before = card(7);
    let mut now = card(7);
    now.results.push(result(2, ResultKind::Progress));
    now.open_questions.push("q-1".to_string());
    now.question = Some("Go ahead?".to_string());
    now.run = RunState::Pending;
    now.history.push("Waiting".to_string());
    let events = diff_task(PROJECT, &before, &now);
    assert_eq!(events.len(), 4);
    let all = settings(|s| {
        s.kinds.state_changes = true;
        s.kinds.history = true;
    });
    let chosen = choose(events.clone(), &all);
    assert_eq!(chosen.len(), 1);
    assert_eq!(chosen[0].0.kind, Kind::Question);
    assert_eq!(chosen[0].1.len(), 4);
    // Without the question kind the result is the one that opens.
    let no_questions = settings(|s| {
        s.kinds.questions = false;
        s.kinds.state_changes = true;
    });
    let chosen = choose(events, &no_questions);
    assert_eq!(chosen.len(), 1);
    assert_eq!(chosen[0].0.kind, Kind::Result(ResultKind::Progress));
}

#[test]
fn events_of_different_tasks_stay_separate() {
    let before: ProjectFacts = [(1, card(1)), (2, card(2))].into();
    let mut a = card(1);
    a.results.push(result(1, ResultKind::Final));
    let mut b = card(2);
    b.results.push(result(1, ResultKind::Final));
    let now: ProjectFacts = [(1, a), (2, b)].into();
    let events = diff(PROJECT, &before, &now);
    assert_eq!(choose(events, &NotificationSettings::default()).len(), 2);
}

#[test]
fn a_card_that_appears_is_followed_but_not_announced() {
    let before: ProjectFacts = ProjectFacts::new();
    let mut fresh = card(3);
    fresh.results.push(result(1, ResultKind::Progress));
    let now: ProjectFacts = [(3, fresh.clone())].into();
    assert!(diff(PROJECT, &before, &now).is_empty());
    let mut later = fresh.clone();
    later.results.push(result(2, ResultKind::Final));
    let after: ProjectFacts = [(3, later)].into();
    assert_eq!(diff(PROJECT, &now, &after).len(), 1);
}
