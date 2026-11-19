use super::*;

#[tokio::test]
async fn a_replacement_subscription_survives_a_late_gone_for_the_old_one() {
    let rig = rig();
    let s = &rig.subscription;
    // The phone replaced its subscription while a request to the old endpoint was in flight.
    rig.store
        .subscribe(
            &s.device_id,
            "https://push.example.dev/send/new",
            &s.p256dh,
            &s.auth,
        )
        .unwrap()
        .unwrap();
    *rig.fake.script.lock().unwrap() = vec![Outcome::Gone];
    rig.dispatcher
        .deliver(&rig.ctx(true), vec![result_event(1)])
        .await;
    assert!(rig.store.is_subscribed("dev_a"));
    assert_eq!(
        rig.store.list()[0].endpoint,
        "https://push.example.dev/send/new"
    );
}
