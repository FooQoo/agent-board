use std::collections::HashMap;

use super::tests::*;
use super::*;
use crate::domain::{Column, RunState};
use crate::server::push_delivery::events::{Facts, ProjectFacts, Record};

fn board(summary: &str) -> HashMap<String, ProjectFacts> {
    let card = Facts {
        id: 12,
        title: "Make the thing".to_string(),
        status: Column::Doing,
        run: RunState::Idle,
        open_questions: Vec::new(),
        question: None,
        results: Vec::new(),
        history: Vec::new(),
        records: vec![Record {
            at: START - 7200,
            text: summary.to_string(),
        }],
        status_changed_at: START,
        run_changed_at: START,
        updated_at: START,
    };
    HashMap::from([(PROJECT.to_string(), [(12, card)].into())])
}

fn periodic_ctx(rig: &Rig, up: bool) -> Context {
    let mut ctx = rig.ctx(up);
    ctx.settings.periodic.enabled = true;
    ctx.settings.periodic.interval_minutes = 30;
    ctx
}

fn schedule(rig: &Rig) -> Schedule {
    Schedule::new((rig.dispatcher.now)(), None)
}

#[tokio::test]
async fn a_report_is_sent_each_interval_even_without_a_new_record() {
    let mut rig = rig();
    let ctx = periodic_ctx(&rig, true);
    let mut schedule = schedule(&rig);
    let known = board("Wrote the first draft");

    rig.advance(29 * 60);
    rig.dispatcher
        .deliver_periodic(&ctx, &mut schedule, &known)
        .await;
    assert!(rig.sent().is_empty(), "not due yet");

    rig.advance(60);
    rig.dispatcher
        .deliver_periodic(&ctx, &mut schedule, &known)
        .await;
    let sent = rig.sent();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].urgency, "normal");
    let json: serde_json::Value =
        serde_json::from_slice(&rig.browser.take().unwrap().open(&sent[0].body)).unwrap();
    assert_eq!(json["tag"], "periodic");
    let body = json["body"].as_str().unwrap();
    assert!(
        body.contains("no new record since the last report"),
        "{body}"
    );
    assert!(body.contains("Wrote the first draft"));
    assert_eq!(
        json["url"],
        format!("https://board.example.dev/?project={PROJECT}&task=12")
    );
    // The time is remembered, so the same minute sends nothing more.
    assert_eq!(
        rig.dispatcher.ledger.periodic_at(),
        Some((rig.dispatcher.now)())
    );
    rig.dispatcher
        .deliver_periodic(&ctx, &mut schedule, &known)
        .await;
    assert_eq!(rig.sent().len(), 1);

    // And the next interval sends the next report.
    rig.advance(30 * 60);
    rig.dispatcher
        .deliver_periodic(&ctx, &mut schedule, &known)
        .await;
    assert_eq!(rig.sent().len(), 2);
}

#[tokio::test]
async fn nothing_is_sent_when_the_setting_is_off_or_nothing_is_in_progress() {
    let rig = rig();
    let mut ctx = periodic_ctx(&rig, true);
    let mut schedule = schedule(&rig);
    rig.advance(3600);
    ctx.settings.periodic.enabled = false;
    rig.dispatcher
        .deliver_periodic(&ctx, &mut schedule, &board("x"))
        .await;
    assert!(rig.sent().is_empty());
    ctx.settings.periodic.enabled = true;
    rig.dispatcher
        .deliver_periodic(&ctx, &mut schedule, &HashMap::new())
        .await;
    assert!(rig.sent().is_empty());
    // The schedule moved on, so the report that had nothing to say is not made again at once.
    rig.dispatcher
        .deliver_periodic(&ctx, &mut schedule, &board("x"))
        .await;
    assert!(rig.sent().is_empty());
}

#[tokio::test]
async fn a_report_waits_for_the_entrance_and_is_recorded_as_skipped() {
    let rig = rig();
    let ctx = periodic_ctx(&rig, false);
    let mut schedule = schedule(&rig);
    rig.advance(3600);
    rig.dispatcher
        .deliver_periodic(&ctx, &mut schedule, &board("x"))
        .await;
    assert!(rig.sent().is_empty());
    assert_eq!(rig.dispatcher.ledger.entries()[0].state, State::Skipped);
}

#[tokio::test]
async fn a_milestone_is_not_held_for_the_periodic_report() {
    let rig = rig();
    let ctx = periodic_ctx(&rig, true);
    // Periodic is on and not yet due; a result still goes out at once.
    rig.dispatcher.deliver(&ctx, vec![result_event(1)]).await;
    assert_eq!(rig.sent().len(), 1);
    let mut schedule = schedule(&rig);
    rig.dispatcher
        .deliver_periodic(&ctx, &mut schedule, &board("x"))
        .await;
    assert_eq!(rig.sent().len(), 1, "the report is not made early either");
}
