use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::*;

#[test]
fn the_status_decides_what_happens_next() {
    for ok in [200, 201, 202] {
        assert_eq!(outcome_of(ok), Outcome::Delivered);
    }
    for gone in [404, 410] {
        assert_eq!(outcome_of(gone), Outcome::Gone);
    }
    for later in [408, 429, 500, 502, 503] {
        assert_eq!(outcome_of(later), Outcome::Retry);
    }
    for refused in [301, 302, 400, 401, 403, 413] {
        assert_eq!(outcome_of(refused), Outcome::Rejected);
    }
}

#[test]
fn a_topic_is_short_url_safe_and_hides_the_tag() {
    let topic = topic_of("result:1:0123456789abcdef0123456789abcdef:12");
    assert_eq!(topic.len(), 32);
    assert!(
        topic
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    );
    assert!(!topic.contains("result"));
    assert_eq!(
        topic,
        topic_of("result:1:0123456789abcdef0123456789abcdef:12")
    );
    assert_ne!(
        topic,
        topic_of("result:2:0123456789abcdef0123456789abcdef:12")
    );
}

/// A push service on the loopback that answers every request with `status`, and hands the
/// request it read (head and body) to the test.
async fn fake_service(
    status: &'static str,
) -> (String, tokio::sync::oneshot::Receiver<(String, Vec<u8>)>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/push/abc", listener.local_addr().unwrap());
    let (tx, rx) = tokio::sync::oneshot::channel();
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut data = Vec::new();
        let mut buf = [0u8; 4096];
        let split = loop {
            let n = socket.read(&mut buf).await.unwrap();
            data.extend_from_slice(&buf[..n]);
            if let Some(i) = data.windows(4).position(|w| w == b"\r\n\r\n") {
                break i + 4;
            }
        };
        let head = String::from_utf8_lossy(&data[..split]).to_string();
        let length: usize = head
            .lines()
            .find_map(|l| {
                l.to_ascii_lowercase()
                    .strip_prefix("content-length:")
                    .map(|v| v.trim().parse().unwrap())
            })
            .unwrap_or(0);
        while data.len() < split + length {
            let n = socket.read(&mut buf).await.unwrap();
            data.extend_from_slice(&buf[..n]);
        }
        socket
            .write_all(format!("HTTP/1.1 {status}\r\ncontent-length: 0\r\nlocation: http://127.0.0.1:1/\r\nconnection: close\r\n\r\n").as_bytes())
            .await
            .unwrap();
        let _ = tx.send((head, data[split..].to_vec()));
    });
    (url, rx)
}

fn request(endpoint: String) -> Request {
    Request {
        endpoint,
        authorization: "vapid t=a.b.c, k=key".to_string(),
        ttl: TTL_SECONDS,
        urgency: "high",
        topic: topic_of("tag"),
        body: vec![1, 2, 3, 4],
    }
}

#[tokio::test]
async fn the_http_transport_posts_the_encrypted_body_with_the_push_headers() {
    let (url, seen) = fake_service("201 Created").await;
    let outcome = HttpTransport::unrestricted().send(request(url)).await;
    assert_eq!(outcome, Outcome::Delivered);
    let (head, body) = seen.await.unwrap();
    let head = head.to_ascii_lowercase();
    assert!(head.starts_with("post /push/abc "));
    assert!(head.contains("authorization: vapid t=a.b.c, k=key"));
    assert!(head.contains("ttl: 86400"));
    assert!(head.contains("urgency: high"));
    assert!(head.contains(&format!("topic: {}", topic_of("tag").to_ascii_lowercase())));
    assert!(head.contains("content-encoding: aes128gcm"));
    assert_eq!(body, vec![1, 2, 3, 4]);
}

#[tokio::test]
async fn the_http_transport_reports_a_gone_subscription_and_follows_no_redirect() {
    let (url, _seen) = fake_service("410 Gone").await;
    assert_eq!(
        HttpTransport::unrestricted().send(request(url)).await,
        Outcome::Gone
    );
    let (url, _seen) = fake_service("302 Found").await;
    assert_eq!(
        HttpTransport::unrestricted().send(request(url)).await,
        Outcome::Rejected
    );
}

#[tokio::test]
async fn an_unreachable_service_is_tried_again_later() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/", listener.local_addr().unwrap());
    drop(listener);
    assert_eq!(
        HttpTransport::unrestricted().send(request(url)).await,
        Outcome::Retry
    );
}

#[tokio::test]
async fn the_real_transport_refuses_an_endpoint_that_is_not_a_public_https_host() {
    for endpoint in [
        "http://push.example.com/x",
        "https://127.0.0.1:9/x",
        "https://localhost/x",
        "https://10.0.0.5/x",
    ] {
        assert_eq!(
            HttpTransport::new()
                .send(request(endpoint.to_string()))
                .await,
            Outcome::Rejected,
            "{endpoint}"
        );
    }
}
