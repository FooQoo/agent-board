use chrono::{DateTime, Utc};

pub trait Clock {
    fn now(&self) -> DateTime<Utc>;
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> DateTime<Utc> {
        todo!()
    }
}

/// A clock that always returns the same instant. For tests.
pub struct FixedClock(pub DateTime<Utc>);

impl Clock for FixedClock {
    fn now(&self) -> DateTime<Utc> {
        todo!()
    }
}

pub fn format_utc(_dt: DateTime<Utc>) -> String {
    todo!()
}

pub fn parse_utc(_s: &str) -> Result<DateTime<Utc>, chrono::ParseError> {
    todo!()
}

pub fn format_local_short(_dt: DateTime<Utc>) -> String {
    todo!()
}

/// serde adapter: `#[serde(with = "skan::clock::serde_utc")]`.
pub mod serde_utc {
    use chrono::{DateTime, Utc};
    use serde::{Deserializer, Serializer};

    pub fn serialize<S: Serializer>(_dt: &DateTime<Utc>, _s: S) -> Result<S::Ok, S::Error> {
        todo!()
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(_d: D) -> Result<DateTime<Utc>, D::Error> {
        todo!()
    }
}
