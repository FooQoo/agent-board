use std::sync::Mutex;

use ring::rand::{SecureRandom, SystemRandom};

use super::*;
use crate::domain::ResultKind;
use crate::server::notification_settings::StateChange;
use crate::server::push_delivery::events::Kind;
use crate::server::push_delivery::transport::SendFuture;
use crate::server::push_delivery::webpush::tests::Browser;

pub(super) const PROJECT: &str = "0123456789abcdef0123456789abcdef";
pub(super) const START: i64 = 1_800_000_000;

/// Records what is posted and answers with the next scripted outcome (delivered when none is left).
#[derive(Default)]
pub(super) struct Fake {
    pub(super) sent: Mutex<Vec<Request>>,
    pub(super) script: Mutex<Vec<Outcome>>,
}

impl PushTransport for Fake {
    fn send(&self, request: Request) -> SendFuture {
        self.sent.lock().unwrap().push(request);
        let outcome = {
            let mut script = self.script.lock().unwrap();
            if script.is_empty() {
                Outcome::Delivered
            } else {
                script.remove(0)
            }
        };
        Box::pin(async move { outcome })
    }
}

pub(super) struct Rig {
    pub(super) fake: Arc<Fake>,
    pub(super) dispatcher: Dispatcher,
    pub(super) clock: Arc<Mutex<i64>>,
    pub(super) store: Arc<PushStore>,
    pub(super) browser: Option<Browser>,
    pub(super) subscription: Subscription,
}

pub(super) fn rig() -> Rig {
    let browser = Browser::new();
    let rng = SystemRandom::new();
    let mut _unused = [0u8; 1];
    rng.fill(&mut _unused).unwrap();
    let subscription = Subscription {
        device_id: "dev_a".to_string(),
        endpoint: "https://push.example.dev/send/abc".to_string(),
        p256dh: B64.encode(&browser.public),
        auth: B64.encode(browser.auth),
        created_at: "2026-11-19T00:00:00Z".to_string(),
    };
    let fake = Arc::new(Fake::default());
    let clock = Arc::new(Mutex::new(START));
    let now_clock = clock.clone();
    let now: NowFn =
        Arc::new(move || DateTime::from_timestamp(*now_clock.lock().unwrap(), 0).unwrap());
    Rig {
        dispatcher: Dispatcher::new(Ledger::in_memory(), fake.clone(), now),
        fake,
        clock,
        store: Arc::new(PushStore::in_memory()),
        browser: Some(browser),
        subscription,
    }
}

impl Rig {
    pub(super) fn ctx(&self, up: bool) -> Context {
        Context {
            store: self.store.clone(),
            subscriptions: vec![self.subscription.clone()],
            origin: up.then(|| PublicOrigin::parse("https://board.example.dev").unwrap()),
            settings: NotificationSettings::default(),
            lang: Lang::En,
        }
    }

    pub(super) fn sent(&self) -> Vec<Request> {
        self.fake.sent.lock().unwrap().clone()
    }

    pub(super) fn advance(&self, seconds: i64) {
        *self.clock.lock().unwrap() += seconds;
    }
}

pub(super) fn event(kind: Kind, key: &str, version: Option<u32>) -> Event {
    Event {
        project: PROJECT.to_string(),
        task: 12,
        title: "Make the thing".to_string(),
        kind,
        key: key.to_string(),
        version,
        detail: "Looks good".to_string(),
    }
}

pub(super) fn result_event(version: u32) -> Event {
    event(
        Kind::Result(ResultKind::Progress),
        &format!("result:{version}"),
        Some(version),
    )
}

#[tokio::test]
async fn a_result_reaches_the_device_encrypted_with_a_link_to_its_version() {
    let mut rig = rig();
    rig.dispatcher
        .deliver(&rig.ctx(true), vec![result_event(2)])
        .await;
    let sent = rig.sent();
    assert_eq!(sent.len(), 1);
    let request = &sent[0];
    assert_eq!(request.endpoint, "https://push.example.dev/send/abc");
    assert!(request.authorization.starts_with("vapid t="));
    assert!(
        request
            .authorization
            .contains(&format!(", k={}", rig.store.public_key().unwrap()))
    );
    assert_eq!(request.urgency, "normal");
    assert_eq!(request.ttl, TTL_SECONDS);
    assert_eq!(request.topic, topic_of("result:2"));

    let plain = rig.browser.take().unwrap().open(&request.body);
    let json: serde_json::Value = serde_json::from_slice(&plain).unwrap();
    assert_eq!(
        json["url"],
        format!("https://board.example.dev/?project={PROJECT}&task=12&result=2")
    );
    assert_eq!(json["tag"], "result:2");
    assert_eq!(json["title"], "A result is ready to look at");
    assert!(!String::from_utf8_lossy(&request.body).contains("Looks good"));
}

#[tokio::test]
async fn the_same_version_read_again_is_not_sent_again() {
    let rig = rig();
    let ctx = rig.ctx(true);
    rig.dispatcher.deliver(&ctx, vec![result_event(1)]).await;
    rig.dispatcher.deliver(&ctx, vec![result_event(1)]).await;
    assert_eq!(rig.sent().len(), 1);
    rig.dispatcher.deliver(&ctx, vec![result_event(2)]).await;
    assert_eq!(rig.sent().len(), 2);
}

#[tokio::test]
async fn a_kind_that_is_off_is_not_sent() {
    let rig = rig();
    let mut ctx = rig.ctx(true);
    ctx.settings.kinds.results = false;
    rig.dispatcher.deliver(&ctx, vec![result_event(1)]).await;
    assert!(rig.sent().is_empty());
    assert!(rig.dispatcher.ledger.entries().is_empty());
}

#[tokio::test]
async fn one_event_with_several_kinds_is_one_notification_for_the_question() {
    let rig = rig();
    let mut ctx = rig.ctx(true);
    ctx.settings.kinds.state_changes = true;
    ctx.settings.kinds.history = true;
    let events = vec![
        result_event(3),
        event(Kind::State(StateChange::Pending), "state:pending:1", None),
        event(Kind::Question, "question:q-1", None),
        event(Kind::History, "history:2", None),
    ];
    rig.dispatcher.deliver(&ctx, events).await;
    let sent = rig.sent();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].urgency, "high");
    assert_eq!(sent[0].topic, topic_of("question:q-1"));
}

#[tokio::test]
async fn a_failed_send_is_tried_again_later_and_then_marked_sent() {
    let rig = rig();
    let ctx = rig.ctx(true);
    *rig.fake.script.lock().unwrap() = vec![Outcome::Retry];
    rig.dispatcher.deliver(&ctx, vec![result_event(1)]).await;
    assert_eq!(rig.sent().len(), 1);
    let entries = rig.dispatcher.ledger.entries();
    assert_eq!(entries[0].state, State::Pending);
    assert_eq!(entries[0].attempts, 1);

    // Not yet due.
    rig.advance(30);
    rig.dispatcher.retry_due(&ctx).await;
    assert_eq!(rig.sent().len(), 1);
    // Due after the first wait.
    rig.advance(40);
    rig.dispatcher.retry_due(&ctx).await;
    assert_eq!(rig.sent().len(), 2);
    assert_eq!(rig.dispatcher.ledger.entries()[0].state, State::Sent);
    // The retry carries the same message, so the device replaces rather than adds.
    assert_eq!(rig.sent()[0].topic, rig.sent()[1].topic);
    rig.dispatcher.retry_due(&ctx).await;
    assert_eq!(rig.sent().len(), 2);
}

#[tokio::test]
async fn a_send_that_keeps_failing_is_given_up_after_a_bounded_number_of_tries() {
    let rig = rig();
    let ctx = rig.ctx(true);
    *rig.fake.script.lock().unwrap() = vec![Outcome::Retry; 10];
    rig.dispatcher.deliver(&ctx, vec![result_event(1)]).await;
    for _ in 0..10 {
        rig.advance(3 * 3600);
        rig.dispatcher.retry_due(&ctx).await;
    }
    assert_eq!(rig.sent().len(), MAX_ATTEMPTS as usize);
    assert_eq!(rig.dispatcher.ledger.entries()[0].state, State::Dropped);
}

#[tokio::test]
async fn a_refused_message_is_not_tried_again() {
    let rig = rig();
    let ctx = rig.ctx(true);
    *rig.fake.script.lock().unwrap() = vec![Outcome::Rejected];
    rig.dispatcher.deliver(&ctx, vec![result_event(1)]).await;
    rig.advance(24 * 3600);
    rig.dispatcher.retry_due(&ctx).await;
    assert_eq!(rig.sent().len(), 1);
    assert_eq!(rig.dispatcher.ledger.entries()[0].state, State::Dropped);
}

#[tokio::test]
async fn a_subscription_the_push_service_forgot_is_removed() {
    let rig = rig();
    let s = &rig.subscription;
    rig.store
        .subscribe(&s.device_id, &s.endpoint, &s.p256dh, &s.auth)
        .unwrap()
        .unwrap();
    assert!(rig.store.is_subscribed("dev_a"));
    *rig.fake.script.lock().unwrap() = vec![Outcome::Gone];
    rig.dispatcher
        .deliver(&rig.ctx(true), vec![result_event(1)])
        .await;
    assert!(!rig.store.is_subscribed("dev_a"));
    assert!(rig.dispatcher.ledger.entries().is_empty());
}

#[tokio::test]
async fn nothing_is_sent_while_the_entrance_is_down_and_it_is_recorded() {
    let rig = rig();
    rig.dispatcher
        .deliver(&rig.ctx(false), vec![result_event(1)])
        .await;
    assert!(rig.sent().is_empty());
    assert_eq!(rig.dispatcher.ledger.entries()[0].state, State::Skipped);
    // Failed sends wait for the address to come back.
    rig.dispatcher.retry_due(&rig.ctx(false)).await;
    // The skipped event is not sent later, when the entrance is up again.
    rig.dispatcher
        .deliver(&rig.ctx(true), vec![result_event(1)])
        .await;
    assert!(rig.sent().is_empty());
}

#[tokio::test]
async fn a_device_without_a_valid_key_gets_a_refusal_not_a_crash() {
    let mut rig = rig();
    rig.subscription.p256dh = "AAAA".to_string();
    rig.dispatcher
        .deliver(&rig.ctx(true), vec![result_event(1)])
        .await;
    assert!(rig.sent().is_empty());
    assert_eq!(rig.dispatcher.ledger.entries()[0].state, State::Dropped);
}
