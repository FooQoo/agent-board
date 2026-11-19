//! The text and the link of one notification.
//!
//! A message is short on purpose: the card's title as the title, and one line under it. That line
//! is the first sentence of the summary, the question, or the history entry, cut short, or, when
//! the event has no text of its own, what happened to the card. The wording follows the board's
//! language setting. The link is built on the public address while the entrance is up; what is
//! kept for a retry is only the path, so a retry after the address changed still opens the board.

use serde::{Deserialize, Serialize};

use super::events::{Event, Kind};
use crate::domain::ResultKind;
use crate::server::monitor_connection::contracts::PublicOrigin;
use crate::server::notification_settings::StateChange;

const TITLE_CHARS: usize = 60;
/// The summary, question, or history entry is cut short: the board has the whole text.
const DETAIL_CHARS: usize = 40;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Lang {
    En,
    Ja,
}

impl Lang {
    /// The language of the board's saved locale (`ja` or `en`); anything else is English.
    pub(super) fn from_locale(locale: &str) -> Self {
        if locale.starts_with("ja") {
            Lang::Ja
        } else {
            Lang::En
        }
    }
}

/// What a device shows: the title and body, where it opens (`path` is the path and query on the
/// public address), the tag that makes a newer message for the same event replace the older
/// one, and whether the push service should deliver it at once.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Payload {
    pub title: String,
    pub body: String,
    pub path: String,
    pub tag: String,
    pub urgent: bool,
}

impl Payload {
    /// The JSON the service worker reads: `{title, body, url, tag}` with the full address.
    pub(super) fn json(&self, origin: &PublicOrigin) -> Vec<u8> {
        serde_json::json!({
            "title": self.title,
            "body": self.body,
            "url": format!("{}{}", origin.origin(), self.path),
            "tag": self.tag,
        })
        .to_string()
        .into_bytes()
    }
}

/// `text` on one line, cut to `max` characters with an ellipsis.
pub(super) fn shorten(text: &str, max: usize) -> String {
    let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if line.chars().count() <= max {
        return line;
    }
    let mut cut: String = line.chars().take(max.saturating_sub(1)).collect();
    cut.push('…');
    cut
}

fn what_happened(kind: Kind, lang: Lang) -> &'static str {
    match (kind, lang) {
        (Kind::Question, Lang::En) => "Your decision is needed",
        (Kind::Question, Lang::Ja) => "判断をお願いします",
        (Kind::Result(ResultKind::Progress), Lang::En) => "A result is ready to look at",
        (Kind::Result(ResultKind::Progress), Lang::Ja) => "途中の成果が届きました",
        (Kind::Result(ResultKind::Final), Lang::En) => "The final result is ready",
        (Kind::Result(ResultKind::Final), Lang::Ja) => "最終の成果が届きました",
        (Kind::State(StateChange::Started), Lang::En) => "A card was started",
        (Kind::State(StateChange::Started), Lang::Ja) => "カードの作業を始めました",
        (Kind::State(StateChange::Pending), Lang::En) => "A card is waiting for you",
        (Kind::State(StateChange::Pending), Lang::Ja) => "カードが回答を待っています",
        (Kind::State(StateChange::Done), Lang::En) => "A card is done",
        (Kind::State(StateChange::Done), Lang::Ja) => "カードが完了しました",
        (Kind::History, Lang::En) => "A history entry was added",
        (Kind::History, Lang::Ja) => "履歴が追加されました",
    }
}

/// `text` up to the end of its first sentence or line, the end mark included.
fn first_sentence(text: &str) -> &str {
    let text = text.trim();
    let mut chars = text.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        let end = i + c.len_utf8();
        match c {
            '\n' => return text[..i].trim_end(),
            '。' | '！' | '？' => return &text[..end],
            '.' | '!' | '?' if chars.peek().is_none_or(|(_, n)| n.is_whitespace()) => {
                return &text[..end];
            }
            _ => {}
        }
    }
    text
}

/// The path and query of `link` on `origin`, so a message can be rebuilt on another address.
fn path_of(origin: &PublicOrigin, link: &str) -> Option<String> {
    link.strip_prefix(origin.origin()).map(str::to_string)
}

/// The message for one event. `None` when the event has no valid link (the ids are not ones the
/// board makes), which is never sent.
pub(super) fn payload_of(event: &Event, lang: Lang, origin: &PublicOrigin) -> Option<Payload> {
    let link = match (event.kind, event.version) {
        (Kind::Result(_), Some(version)) => origin.result_link(&event.project, event.task, version),
        _ => origin.task_link(&event.project, event.task),
    }?;
    let detail = shorten(first_sentence(&event.detail), DETAIL_CHARS);
    let body = if detail.is_empty() {
        what_happened(event.kind, lang).to_string()
    } else {
        detail
    };
    Some(Payload {
        title: shorten(&event.title, TITLE_CHARS),
        body,
        path: path_of(origin, &link)?,
        tag: event.key.clone(),
        urgent: event.kind == Kind::Question,
    })
}

#[cfg(test)]
mod tests;
