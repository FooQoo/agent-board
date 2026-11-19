use super::*;

const ENDPOINT: &str = "https://web.push.apple.com/QGxyz";

fn p256dh() -> String {
    let mut k = vec![4u8];
    k.extend_from_slice(&[7u8; 64]);
    B64.encode(k)
}

fn auth() -> String {
    B64.encode([9u8; 16])
}

#[test]
fn endpoints_must_be_public_https_addresses() {
    assert!(endpoint_ok(ENDPOINT));
    for bad in [
        "http://web.push.apple.com/x",
        "https://127.0.0.1/x",
        "https://[::1]/x",
        "https://localhost/x",
        "https://intranet/x",
        "https://user:pw@web.push.apple.com/x",
        "not a url",
        &format!(
            "https://web.push.apple.com/{}",
            "a".repeat(check::MAX_ENDPOINT)
        ),
    ] {
        assert!(!endpoint_ok(bad), "{bad}");
    }
}

#[test]
fn a_subscription_is_validated_and_replaces_the_older_one() {
    let s = PushStore::in_memory();
    assert_eq!(
        s.subscribe("dev_a", "http://x.io/", &p256dh(), &auth()),
        Ok(Err(Invalid::Endpoint))
    );
    assert_eq!(
        s.subscribe("dev_a", ENDPOINT, "AAAA", &auth()),
        Ok(Err(Invalid::Keys))
    );
    assert_eq!(
        s.subscribe("dev_a", ENDPOINT, &p256dh(), "AAAA"),
        Ok(Err(Invalid::Keys))
    );
    assert_eq!(
        s.subscribe("dev_a", ENDPOINT, "not base64!", &auth()),
        Ok(Err(Invalid::Keys))
    );
    assert!(s.list().is_empty());
    assert_eq!(
        s.subscribe("dev_a", ENDPOINT, &p256dh(), &auth()),
        Ok(Ok(()))
    );
    let newer = "https://fcm.googleapis.com/fcm/send/2";
    assert_eq!(s.subscribe("dev_a", newer, &p256dh(), &auth()), Ok(Ok(())));
    assert_eq!(
        s.subscribe("dev_b", ENDPOINT, &p256dh(), &auth()),
        Ok(Ok(()))
    );
    let list = s.list();
    assert_eq!(list.len(), 2);
    assert_eq!(
        list.iter()
            .find(|x| x.device_id == "dev_a")
            .unwrap()
            .endpoint,
        newer
    );
}

#[test]
fn unsubscribing_and_pruning_remove_only_what_is_asked() {
    let s = PushStore::in_memory();
    s.subscribe("dev_a", ENDPOINT, &p256dh(), &auth())
        .unwrap()
        .unwrap();
    s.subscribe("dev_b", ENDPOINT, &p256dh(), &auth())
        .unwrap()
        .unwrap();
    assert_eq!(s.unsubscribe("dev_x"), Ok(false));
    assert_eq!(s.unsubscribe("dev_a"), Ok(true));
    assert!(!s.is_subscribed("dev_a"));
    s.retain_devices(|id| id == "dev_c");
    assert!(s.list().is_empty());
}

#[test]
fn subscriptions_and_the_key_survive_a_reopen_and_are_owner_only() {
    let dir = tempfile::tempdir().unwrap();
    let s = PushStore::open(dir.path());
    let key = s.public_key().unwrap();
    s.subscribe("dev_a", ENDPOINT, &p256dh(), &auth())
        .unwrap()
        .unwrap();
    let again = PushStore::open(dir.path());
    assert_eq!(again.public_key().unwrap(), key);
    assert!(again.is_subscribed("dev_a"));
    assert_eq!(B64.decode(&key).unwrap().len(), 65);
    #[cfg(unix)]
    for name in [KEY_FILE, SUBSCRIPTIONS_FILE] {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(dir.path().join(".internal").join(name))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o077, 0, "{name}");
    }
}

#[test]
fn a_new_key_drops_subscriptions_made_for_the_old_one_and_the_signer_matches() {
    let dir = tempfile::tempdir().unwrap();
    let s = PushStore::open(dir.path());
    s.subscribe("dev_a", ENDPOINT, &p256dh(), &auth())
        .unwrap()
        .unwrap();
    std::fs::remove_file(dir.path().join(".internal").join(KEY_FILE)).ok();
    let s = PushStore::open(dir.path());
    let public = s.public_key().unwrap();
    assert!(s.list().is_empty());
    let signer = s.vapid_signer().unwrap();
    assert_eq!(B64.encode(signer.public_key().as_ref()), public);
}

#[test]
fn an_unreadable_file_means_no_subscriptions() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join(".internal")).unwrap();
    std::fs::write(
        dir.path().join(".internal").join(SUBSCRIPTIONS_FILE),
        "{nope",
    )
    .unwrap();
    assert!(PushStore::open(dir.path()).list().is_empty());
}

#[test]
fn unsubscribing_an_endpoint_keeps_a_replacement() {
    let s = PushStore::in_memory();
    s.subscribe("dev_a", ENDPOINT, &p256dh(), &auth())
        .unwrap()
        .unwrap();
    let newer = "https://web.push.apple.com/Other";
    s.subscribe("dev_a", newer, &p256dh(), &auth())
        .unwrap()
        .unwrap();
    assert_eq!(s.unsubscribe_endpoint("dev_a", ENDPOINT), Ok(false));
    assert!(s.is_subscribed("dev_a"));
    assert_eq!(s.unsubscribe_endpoint("dev_a", newer), Ok(true));
    assert!(!s.is_subscribed("dev_a"));
}
