//! The periodic status notification: every configured interval, one message that says what the
//! board's records show about the work in progress.
//!
//! The message reads only the board: for each card in Doing, the records written since the last
//! report (history entries and results), or, when there are none, the time and content of the
//! last record. It never concludes from old history that work is still going on. The one thing it
//! says about the run state is the card's own run state as the agent set it, and it says so: the
//! agent reports that it is running. A first draft, a final result, or a decision request is not
//! held for this message; those are sent at once by the milestone notifications.

use std::collections::HashMap;

use chrono::{DateTime, Duration, Utc};

use super::events::{Facts, ProjectFacts, Record};
use super::message::{Lang, Payload, shorten};
use crate::clock::format_local_short;
use crate::domain::{Column, RunState};
use crate::server::monitor_connection::contracts::PublicOrigin;

/// How many cards one message lists; the rest are counted.
const MAX_CARDS: usize = 5;
const TEXT_CHARS: usize = 60;
/// The tag of every periodic message, so a new one replaces the last on the device.
pub(super) const TAG: &str = "periodic";

/// When the next report is due. The interval counts from the last report, or from the start of
/// the server when there has not been one, so a restart does not send one at once.
pub(super) struct Schedule {
    last: Option<DateTime<Utc>>,
    started: DateTime<Utc>,
}

impl Schedule {
    pub(super) fn new(started: DateTime<Utc>, last: Option<DateTime<Utc>>) -> Self {
        Self { last, started }
    }

    fn interval(minutes: u32) -> Duration {
        Duration::minutes(i64::from(minutes))
    }

    pub(super) fn due(&self, now: DateTime<Utc>, minutes: u32) -> bool {
        now >= self.last.unwrap_or(self.started) + Self::interval(minutes)
    }

    /// Records after this time are new to the report: those since the last report, or, for the
    /// first one, those of the last interval.
    pub(super) fn since(&self, minutes: u32) -> DateTime<Utc> {
        self.last.unwrap_or(self.started - Self::interval(minutes))
    }

    pub(super) fn mark(&mut self, now: DateTime<Utc>) {
        self.last = Some(now);
    }
}

fn time_of(at: i64) -> String {
    DateTime::from_timestamp(at, 0)
        .map(format_local_short)
        .unwrap_or_default()
}

/// What one card says in the report.
fn line(card: &Facts, since: i64, lang: Lang) -> String {
    let title = shorten(&card.title, TEXT_CHARS);
    let fresh = card.records.iter().filter(|r| r.at > since).count();
    let latest: Option<&Record> = card.records.last();
    let ja = lang == Lang::Ja;
    let mut text = match (latest, fresh) {
        (None, _) if ja => format!("#{} {title}: 記録はまだありません。", card.id),
        (None, _) => format!("#{} {title}: no record yet.", card.id),
        (Some(r), 0) if ja => format!(
            "#{} {title}: 前回の通知以降、新しい記録はありません。最終更新 {}: {}",
            card.id,
            time_of(r.at),
            shorten(&r.text, TEXT_CHARS)
        ),
        (Some(r), 0) => format!(
            "#{} {title}: no new record since the last report. Last update {}: {}",
            card.id,
            time_of(r.at),
            shorten(&r.text, TEXT_CHARS)
        ),
        (Some(r), n) if ja => format!(
            "#{} {title}: 新しい記録が{n}件。最新 {}: {}",
            card.id,
            time_of(r.at),
            shorten(&r.text, TEXT_CHARS)
        ),
        (Some(r), n) => format!(
            "#{} {title}: {n} new record{}. Latest {}: {}",
            card.id,
            if n == 1 { "" } else { "s" },
            time_of(r.at),
            shorten(&r.text, TEXT_CHARS)
        ),
    };
    // The only things said about the run state are the ones the board holds: a question is
    // open, or the agent set its status to running.
    match (card.run, ja) {
        (RunState::Pending, true) => text.push_str(" 回答待ちです。"),
        (RunState::Pending, false) => text.push_str(" Waiting for your answer."),
        (RunState::Running, true) => text.push_str(" エージェントは実行中と自己申告しています。"),
        (RunState::Running, false) => {
            text.push_str(" The agent reports it is running (self-report).");
        }
        (RunState::Idle, _) => {}
    }
    text
}

fn path_of(origin: &PublicOrigin, link: &str) -> String {
    link.strip_prefix(origin.origin())
        .unwrap_or("/")
        .to_string()
}

/// The message for the cards in Doing across `known`, or `None` when there are none.
pub(super) fn report(
    known: &HashMap<String, ProjectFacts>,
    since: DateTime<Utc>,
    lang: Lang,
    origin: &PublicOrigin,
) -> Option<Payload> {
    let mut cards: Vec<(&str, &Facts)> = known
        .iter()
        .flat_map(|(project, facts)| facts.values().map(move |f| (project.as_str(), f)))
        .filter(|(_, card)| card.status == Column::Doing)
        .collect();
    cards.sort_by(|a, b| (a.0, a.1.id).cmp(&(b.0, b.1.id)));
    let first = cards.first()?;
    let link = if cards.len() == 1 {
        origin.task_link(first.0, first.1.id)
    } else if cards.iter().all(|c| c.0 == first.0) {
        origin.project_link(first.0)
    } else {
        Some(format!("{}/", origin.origin()))
    };
    let mut lines: Vec<String> = cards
        .iter()
        .take(MAX_CARDS)
        .map(|(_, card)| line(card, since.timestamp(), lang))
        .collect();
    if cards.len() > MAX_CARDS {
        let more = cards.len() - MAX_CARDS;
        lines.push(match lang {
            Lang::Ja => format!("ほか{more}件"),
            Lang::En => format!("and {more} more"),
        });
    }
    let n = cards.len();
    let title = match lang {
        Lang::Ja => format!("進行中の作業: {n}件"),
        Lang::En => format!(
            "Work in progress: {n} card{}",
            if n == 1 { "" } else { "s" }
        ),
    };
    Some(Payload {
        title,
        body: lines.join("\n"),
        path: path_of(origin, &link?),
        tag: TAG.to_string(),
        urgent: false,
    })
}

#[cfg(test)]
mod tests;
