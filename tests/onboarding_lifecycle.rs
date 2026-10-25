//! The first-run guide's run on the shared files: the lease, the start and its
//! retries, the scripted steps, the answer gate, finish, abort, and recovery.

use std::path::PathBuf;

use agent_board::domain::{Column, ProjectId, RunState};
use agent_board::error::AgboardError;
use agent_board::file_store::FileStore;
use agent_board::file_store::onboarding_state::{
    GuideLocale, GuidePhase, GuideStatus, GuideTransition, OnboardingFile,
};
use chrono::{DateTime, Duration, TimeZone, Utc};

fn at(second: i64) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 22, 0, 0, 0).unwrap() + Duration::seconds(second)
}

struct Fixture {
    _root: tempfile::TempDir,
    shared: PathBuf,
    store: FileStore,
    project: ProjectId,
}

fn fixture() -> Fixture {
    let root = tempfile::tempdir().unwrap();
    let shared = root.path().join("shared");
    let store = FileStore::open(&shared);
    let project = store.create_project("Guide", at(0)).unwrap().id;
    Fixture {
        _root: root,
        shared,
        store,
        project,
    }
}

/// Claim and start a run; returns the state after the start.
fn started(f: &Fixture, client: &str, attempt: &str, now: i64) -> OnboardingFile {
    let claimed = f.store.guide_claim(client, 0, at(now)).unwrap();
    f.store
        .guide_start(
            &f.project,
            client,
            attempt,
            claimed.revision,
            GuideLocale::En,
            at(now),
        )
        .unwrap()
}

fn run_id(file: &OnboardingFile) -> String {
    file.run.as_ref().unwrap().run_id.clone()
}

fn sample_ids(file: &OnboardingFile) -> Vec<i64> {
    file.run.as_ref().unwrap().sample_ids.clone()
}

fn card_state(f: &Fixture, id: i64) -> (Column, RunState, bool) {
    let view = f.store.task(&f.project, id).unwrap();
    (
        view.task_status,
        view.agent_status,
        view.archived_at.is_some(),
    )
}

#[test]
fn a_tab_holds_the_guide_and_a_second_tab_is_refused_until_the_lease_lapses() {
    let f = fixture();
    let first = f.store.guide_claim("tab-a", 0, at(0)).unwrap();
    assert_eq!(first.status, GuideStatus::Offered);
    let refused = f
        .store
        .guide_claim("tab-b", first.revision, at(5))
        .unwrap_err();
    assert!(matches!(refused, AgboardError::OnboardingConflict { .. }));
    // After the lease lapses, the other tab may take the guide.
    let later = f
        .store
        .guide_claim("tab-b", first.revision, at(60))
        .unwrap();
    assert_eq!(later.owner.unwrap().client_id, "tab-b");
}

#[test]
fn a_start_creates_exactly_two_identified_ai_cards() {
    let f = fixture();
    let file = started(&f, "tab-a", "attempt-1", 0);
    let ids = sample_ids(&file);
    assert_eq!(ids.len(), 2);
    assert_eq!(file.status, GuideStatus::Active);
    for (ordinal, id) in ids.iter().enumerate() {
        let view = f.store.task(&f.project, *id).unwrap();
        assert_eq!(view.assignee, agent_board::domain::Assignee::Ai);
        assert_eq!(
            view.onboarding_sample.as_ref().unwrap().ordinal as usize,
            ordinal + 1
        );
        assert_eq!(
            view.onboarding_sample.as_ref().unwrap().run_id,
            run_id(&file)
        );
    }
}

#[test]
fn a_repeated_start_with_the_same_attempt_returns_the_same_cards() {
    let f = fixture();
    let first = started(&f, "tab-a", "attempt-1", 0);
    let again = f
        .store
        .guide_start(
            &f.project,
            "tab-a",
            "attempt-1",
            first.revision,
            GuideLocale::En,
            at(1),
        )
        .unwrap();
    assert_eq!(sample_ids(&again), sample_ids(&first));
    assert_eq!(f.store.snapshot(&f.project).unwrap().tasks.len(), 2);
}

#[test]
fn a_partly_created_run_is_completed_on_the_next_start_without_duplicates() {
    let f = fixture();
    let claimed = f.store.guide_claim("tab-a", 0, at(0)).unwrap();
    let started_run = f
        .store
        .guide_start(
            &f.project,
            "tab-a",
            "attempt-1",
            claimed.revision,
            GuideLocale::En,
            at(0),
        )
        .unwrap();
    // Simulate a crash after the first card was written but before the second one.
    let first_id = sample_ids(&started_run);
    assert_eq!(first_id.len(), 2);
    let mut crashed = started_run.clone();
    crashed.run.as_mut().unwrap().sample_ids.truncate(1);
    agent_board::file_store::onboarding_state::write(&f.shared, &crashed).unwrap();
    let completed = f
        .store
        .guide_start(
            &f.project,
            "tab-a",
            "attempt-1",
            crashed.revision,
            GuideLocale::En,
            at(1),
        )
        .unwrap();
    assert_eq!(sample_ids(&completed), first_id);
    assert_eq!(f.store.snapshot(&f.project).unwrap().tasks.len(), 2);
}

#[test]
fn the_scripted_steps_run_in_order_and_the_answer_gates_the_second_card() {
    let f = fixture();
    let file = started(&f, "tab-a", "attempt-1", 0);
    let run = run_id(&file);
    let [first, second] = [sample_ids(&file)[0], sample_ids(&file)[1]];
    let step = |file: &OnboardingFile, transition, command: &str, now: i64| {
        f.store
            .guide_advance(
                &f.project,
                &run,
                "tab-a",
                file.revision,
                command,
                transition,
                at(now),
            )
            .unwrap()
    };

    // A step out of order is refused.
    let out_of_order = f
        .store
        .guide_advance(
            &f.project,
            &run,
            "tab-a",
            file.revision,
            "c0",
            GuideTransition::FirstDone,
            at(1),
        )
        .unwrap_err();
    assert!(matches!(
        out_of_order,
        AgboardError::OnboardingInvalid { .. }
    ));

    let file = step(&file, GuideTransition::FirstRunning, "c1", 2);
    assert_eq!(
        card_state(&f, first),
        (Column::Doing, RunState::Running, false)
    );

    let file = step(&file, GuideTransition::FirstDone, "c2", 3);
    assert_eq!(card_state(&f, first).0, Column::Done);

    let file = step(&file, GuideTransition::AskQuestion, "c3", 4);
    assert_eq!(file.run.as_ref().unwrap().phase, GuidePhase::Question);
    let request = f
        .store
        .task(&f.project, second)
        .unwrap()
        .pending_request_id
        .unwrap();

    // Resuming before the answer is saved is refused.
    let early = f
        .store
        .guide_advance(
            &f.project,
            &run,
            "tab-a",
            file.revision,
            "c4",
            GuideTransition::ResumeSecond,
            at(5),
        )
        .unwrap_err();
    assert!(matches!(early, AgboardError::OnboardingInvalid { .. }));

    f.store
        .answer_request(
            &f.project,
            second,
            &request,
            agent_board::file_store::Answer {
                actor: agent_board::domain::Actor::Human,
                choice_id: Some("brief".into()),
                text: None,
            },
            at(6),
        )
        .unwrap();

    let file = step(&file, GuideTransition::ResumeSecond, "c5", 7);
    assert_eq!(card_state(&f, second).1, RunState::Running);
    let file = step(&file, GuideTransition::SecondDone, "c6", 8);
    assert_eq!(card_state(&f, second).0, Column::Done);
    let file = step(&file, GuideTransition::Complete, "c7", 9);
    assert_eq!(file.run.as_ref().unwrap().phase, GuidePhase::Complete);
}

#[test]
fn a_repeated_command_returns_the_current_state_without_repeating_the_step() {
    let f = fixture();
    let file = started(&f, "tab-a", "attempt-1", 0);
    let run = run_id(&file);
    let once = f
        .store
        .guide_advance(
            &f.project,
            &run,
            "tab-a",
            file.revision,
            "same",
            GuideTransition::FirstRunning,
            at(1),
        )
        .unwrap();
    let twice = f
        .store
        .guide_advance(
            &f.project,
            &run,
            "tab-a",
            file.revision,
            "same",
            GuideTransition::FirstRunning,
            at(2),
        )
        .unwrap();
    assert_eq!(once, twice);
}

#[test]
fn a_stale_revision_is_a_conflict() {
    let f = fixture();
    let file = started(&f, "tab-a", "attempt-1", 0);
    let run = run_id(&file);
    let err = f
        .store
        .guide_advance(
            &f.project,
            &run,
            "tab-a",
            file.revision - 1,
            "stale",
            GuideTransition::FirstRunning,
            at(1),
        )
        .unwrap_err();
    assert!(matches!(err, AgboardError::OnboardingConflict { .. }));
}

#[test]
fn finish_archives_only_the_two_samples_and_marks_the_guide_completed() {
    let f = fixture();
    let ordinary = f
        .store
        .create_task(
            &f.project,
            agent_board::domain::NewTask {
                title: "Ordinary".into(),
                description: "---\nacceptance: []\n---\n\nbody".into(),
                assignee: agent_board::domain::Assignee::Ai,
                actor: agent_board::domain::Actor::Ai,
                is_draft: false,
            },
            at(0),
        )
        .unwrap()
        .id;
    let file = started(&f, "tab-a", "attempt-1", 0);
    let run = run_id(&file);
    let samples = sample_ids(&file);
    let mut file = file;
    for (index, transition) in [
        GuideTransition::FirstRunning,
        GuideTransition::FirstDone,
        GuideTransition::AskQuestion,
    ]
    .into_iter()
    .enumerate()
    {
        file = f
            .store
            .guide_advance(
                &f.project,
                &run,
                "tab-a",
                file.revision,
                &format!("s{index}"),
                transition,
                at(index as i64 + 1),
            )
            .unwrap();
    }
    let request = f
        .store
        .task(&f.project, samples[1])
        .unwrap()
        .pending_request_id
        .unwrap();
    f.store
        .answer_request(
            &f.project,
            samples[1],
            &request,
            agent_board::file_store::Answer {
                actor: agent_board::domain::Actor::Human,
                choice_id: Some("brief".into()),
                text: None,
            },
            at(10),
        )
        .unwrap();
    for (index, transition) in [
        GuideTransition::ResumeSecond,
        GuideTransition::SecondDone,
        GuideTransition::Complete,
    ]
    .into_iter()
    .enumerate()
    {
        file = f
            .store
            .guide_advance(
                &f.project,
                &run,
                "tab-a",
                file.revision,
                &format!("t{index}"),
                transition,
                at(11 + index as i64),
            )
            .unwrap();
    }
    let finished = f
        .store
        .guide_finish(&f.project, &run, "tab-a", file.revision, "fin", at(20))
        .unwrap();
    assert_eq!(finished.status, GuideStatus::Completed);
    assert!(finished.owner.is_none());
    for id in samples {
        assert!(card_state(&f, id).2, "sample {id} is archived");
    }
    assert!(
        !card_state(&f, ordinary).2,
        "the ordinary card is untouched"
    );
}

#[test]
fn abort_archives_the_samples_and_the_guide_is_offered_again_later() {
    let f = fixture();
    let file = started(&f, "tab-a", "attempt-1", 0);
    let run = run_id(&file);
    let aborted = f
        .store
        .guide_abort(&f.project, &run, "tab-a", file.revision, "abort", at(5))
        .unwrap();
    assert_eq!(aborted.status, GuideStatus::Interrupted);
    for id in sample_ids(&file) {
        assert!(card_state(&f, id).2);
    }
    let claimed = f
        .store
        .guide_claim("tab-b", aborted.revision, at(100))
        .unwrap();
    assert_eq!(claimed.status, GuideStatus::Offered);
}

#[test]
fn recovery_takes_back_a_run_whose_tab_has_gone() {
    let f = fixture();
    let file = started(&f, "tab-a", "attempt-1", 0);
    // The lease lapses without a heartbeat: the run is recovered.
    assert!(
        !f.store.guide_recover(at(5)).unwrap(),
        "the lease is still live"
    );
    assert!(f.store.guide_recover(at(100)).unwrap());
    let state = f.store.guide().unwrap();
    assert_eq!(state.status, GuideStatus::Interrupted);
    for id in sample_ids(&file) {
        assert!(card_state(&f, id).2);
    }
    assert!(
        !f.store.guide_recover(at(101)).unwrap(),
        "nothing left to recover"
    );
}

#[test]
fn skip_is_kept_and_the_guide_is_not_offered_again() {
    let f = fixture();
    let claimed = f.store.guide_claim("tab-a", 0, at(0)).unwrap();
    let skipped = f
        .store
        .guide_skip("tab-a", claimed.revision, "skip", at(1))
        .unwrap();
    assert_eq!(skipped.status, GuideStatus::Skipped);
    let refused = f
        .store
        .guide_claim("tab-b", skipped.revision, at(100))
        .unwrap_err();
    assert!(matches!(refused, AgboardError::OnboardingConflict { .. }));
    assert_eq!(f.store.snapshot(&f.project).unwrap().tasks.len(), 0);
}

#[test]
fn the_state_file_survives_a_restart() {
    let f = fixture();
    let file = started(&f, "tab-a", "attempt-1", 0);
    let reopened = FileStore::open(&f.shared);
    assert_eq!(reopened.guide().unwrap(), file);
}

#[test]
fn a_reloaded_tab_takes_back_its_own_run_before_the_guide_is_offered_again() {
    let f = fixture();
    let file = started(&f, "tab-a", "attempt-1", 0);
    let reloaded = f.store.guide_claim("tab-a", file.revision, at(3)).unwrap();
    assert_eq!(reloaded.status, GuideStatus::Offered);
    for id in sample_ids(&file) {
        assert!(
            card_state(&f, id).2,
            "the reloaded run's card {id} is archived"
        );
    }
}

#[test]
fn a_replay_offers_a_skipped_guide_again_while_a_plain_claim_still_refuses_it() {
    let f = fixture();
    let claimed = f.store.guide_claim("tab-a", 0, at(0)).unwrap();
    let skipped = f
        .store
        .guide_skip("tab-a", claimed.revision, "skip", at(1))
        .unwrap();
    let refused = f
        .store
        .guide_claim("tab-b", skipped.revision, at(100))
        .unwrap_err();
    assert!(matches!(refused, AgboardError::OnboardingConflict { .. }));
    let offered = f
        .store
        .guide_replay("tab-b", skipped.revision, at(100))
        .unwrap();
    assert_eq!(offered.status, GuideStatus::Offered);
    assert_eq!(offered.owner.unwrap().client_id, "tab-b");
    assert_eq!(f.store.snapshot(&f.project).unwrap().tasks.len(), 0);
}

#[test]
fn a_replay_run_creates_two_new_samples() {
    let f = fixture();
    let claimed = f.store.guide_claim("tab-a", 0, at(0)).unwrap();
    let skipped = f
        .store
        .guide_skip("tab-a", claimed.revision, "skip", at(1))
        .unwrap();
    let offered = f
        .store
        .guide_replay("tab-b", skipped.revision, at(100))
        .unwrap();
    let run = f
        .store
        .guide_start(
            &f.project,
            "tab-b",
            "attempt-2",
            offered.revision,
            GuideLocale::En,
            at(101),
        )
        .unwrap();
    assert_eq!(run.status, GuideStatus::Active);
    assert_eq!(sample_ids(&run).len(), 2);
}

#[test]
fn a_replay_waits_for_the_lease_of_another_tab() {
    let f = fixture();
    let claimed = f.store.guide_claim("tab-a", 0, at(0)).unwrap();
    let refused = f
        .store
        .guide_replay("tab-b", claimed.revision, at(5))
        .unwrap_err();
    assert!(matches!(refused, AgboardError::OnboardingConflict { .. }));
}
