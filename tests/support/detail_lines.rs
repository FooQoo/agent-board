//! Reading the NDJSON body of a Task Detail response in tests.

#![allow(dead_code)]

use serde_json::Value;

/// Every line of the body as JSON.
pub fn lines(body: &str) -> Vec<Value> {
    body.lines()
        .map(|line| serde_json::from_str(line).unwrap_or_else(|_| panic!("not JSON: {line:?}")))
        .collect()
}

/// The `history-item` events, oldest first.
pub fn history(body: &str) -> Vec<Value> {
    lines(body)
        .into_iter()
        .filter(|event| event["type"] == "history-item")
        .collect()
}

/// The document blocks joined: the Markdown body.
pub fn document(body: &str) -> String {
    lines(body)
        .iter()
        .filter(|event| event["type"] == "block")
        .map(|event| event["text"].as_str().unwrap().to_string())
        .collect()
}
