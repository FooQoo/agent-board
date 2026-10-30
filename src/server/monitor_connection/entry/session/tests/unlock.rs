use super::*;

#[tokio::test]
async fn unlock_needs_post_the_page_origin_fetch_site_and_a_small_json_body() {
    let now = Arc::new(AtomicU64::new(0));
    let p = policy(&now, 1, ORIGIN);
    let good = r#"{"code":"4821"}"#;
    let without = |skip: &str| -> Vec<(&str, &str)> {
        PAGE.iter().filter(|(k, _)| *k != skip).cloned().collect()
    };
    let get = Request::builder()
        .method(Method::GET)
        .uri(UNLOCK)
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        unlock(&p, get).await.status(),
        StatusCode::METHOD_NOT_ALLOWED
    );
    for (name, pairs, want) in [
        ("no origin", without("origin"), StatusCode::FORBIDDEN),
        (
            "no fetch metadata",
            without("sec-fetch-site"),
            StatusCode::FORBIDDEN,
        ),
        (
            "foreign origin",
            vec![
                ("origin", "https://evil.example"),
                ("sec-fetch-site", "same-origin"),
                ("content-type", "application/json"),
            ],
            StatusCode::FORBIDDEN,
        ),
        (
            "cross-site",
            vec![
                ("origin", ORIGIN),
                ("sec-fetch-site", "cross-site"),
                ("content-type", "application/json"),
            ],
            StatusCode::FORBIDDEN,
        ),
        (
            "not json",
            vec![
                ("origin", ORIGIN),
                ("sec-fetch-site", "same-origin"),
                ("content-type", "text/plain"),
            ],
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
        ),
        (
            "no content type",
            without("content-type"),
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
        ),
    ] {
        let r = unlock(&p, post(UNLOCK, &pairs, good)).await;
        assert_eq!(r.status(), want, "{name}");
        assert!(!r.headers().contains_key(header::SET_COOKIE), "{name}");
    }
    for (name, body, want) in [
        ("not json", "4821", StatusCode::BAD_REQUEST),
        ("a number", r#"{"code":4821}"#, StatusCode::BAD_REQUEST),
        ("no code", "{}", StatusCode::BAD_REQUEST),
        (
            "an extra field",
            r#"{"code":"4821","x":1}"#,
            StatusCode::BAD_REQUEST,
        ),
    ] {
        let r = unlock(&p, post(UNLOCK, &PAGE, body)).await;
        assert_eq!(r.status(), want, "{name}");
    }
    let big = format!(r#"{{"code":"{}"}}"#, "1".repeat(4096));
    assert_eq!(
        unlock(&p, post(UNLOCK, &PAGE, &big)).await.status(),
        StatusCode::PAYLOAD_TOO_LARGE
    );
    // None of the twelve refusals above counted as a wrong guess: the right
    // passcode still works after more than the limit of them.
    assert_eq!(try_code(&p, CODE).await.status(), StatusCode::OK);
}

#[tokio::test]
async fn five_wrong_passcodes_in_a_row_stop_the_answer_even_to_the_right_one() {
    let now = Arc::new(AtomicU64::new(0));
    let p = policy(&now, 1, ORIGIN);
    for _ in 0..MAX_FAILURES {
        let wrong = try_code(&p, "0000").await;
        assert_eq!(wrong.status(), StatusCode::FORBIDDEN);
        assert!(!wrong.headers().contains_key(header::SET_COOKIE));
        let body = body_of(wrong).await;
        assert_eq!(body["error"]["code"], "unlock_failed");
        // Nothing says how close the guess was or how many tries are left.
        assert!(!body.to_string().contains(CODE));
        assert!(!body.to_string().to_lowercase().contains("left"));
    }
    for code in ["0000", CODE, CODE] {
        let locked = try_code(&p, code).await;
        assert_eq!(locked.status(), StatusCode::TOO_MANY_REQUESTS, "{code}");
        assert!(!locked.headers().contains_key(header::SET_COOKIE));
        assert_eq!(body_of(locked).await["error"]["code"], "unlock_locked");
    }
    assert!(p.sessions.is_empty());
}

#[tokio::test]
async fn a_success_between_wrong_guesses_resets_the_count() {
    let now = Arc::new(AtomicU64::new(0));
    let p = policy(&now, 1, ORIGIN);
    for _ in 0..MAX_FAILURES - 1 {
        assert_eq!(try_code(&p, "0000").await.status(), StatusCode::FORBIDDEN);
    }
    assert_eq!(try_code(&p, CODE).await.status(), StatusCode::OK);
    for _ in 0..MAX_FAILURES - 1 {
        assert_eq!(try_code(&p, "0000").await.status(), StatusCode::FORBIDDEN);
    }
    assert_eq!(try_code(&p, CODE).await.status(), StatusCode::OK);
}
