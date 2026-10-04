use chrono::{DateTime, Local, NaiveDateTime, Utc};

pub trait Clock {
    fn now(&self) -> DateTime<Utc>;
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> DateTime<Utc> {
        Utc::now()
    }
}

/// A clock that always returns the same instant. For tests.
pub struct FixedClock(pub DateTime<Utc>);

impl Clock for FixedClock {
    fn now(&self) -> DateTime<Utc> {
        self.0
    }
}

const UTC_FORMAT: &str = "%Y-%m-%dT%H:%M:%SZ";

/// Format as UTC RFC 3339 with second precision, e.g. `2026-10-02T01:08:00Z`.
pub fn format_utc(dt: DateTime<Utc>) -> String {
    dt.format(UTC_FORMAT).to_string()
}

/// Parse a `Z`-suffixed UTC timestamp with second precision. Offsets such as
/// `+09:00` are rejected.
pub fn parse_utc(s: &str) -> Result<DateTime<Utc>, chrono::ParseError> {
    NaiveDateTime::parse_from_str(s, UTC_FORMAT).map(|naive| naive.and_utc())
}

/// Format in the local time zone as `MM/DD HH:mm`, e.g. `10/02 10:08`.
pub fn format_local_short(dt: DateTime<Utc>) -> String {
    dt.with_timezone(&Local).format("%m/%d %H:%M").to_string()
}

/// serde adapter: `#[serde(with = "agent_board::clock::serde_utc")]`.
pub mod serde_utc {
    use chrono::{DateTime, Utc};
    use serde::{Deserialize, Deserializer, Serializer, de::Error};

    pub fn serialize<S: Serializer>(dt: &DateTime<Utc>, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&super::format_utc(*dt))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<DateTime<Utc>, D::Error> {
        let text = String::deserialize(d)?;
        super::parse_utc(&text).map_err(D::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use super::*;

    fn sample() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, 2, 1, 8, 0).unwrap()
    }

    #[test]
    fn format_utc_uses_second_precision_and_z() {
        assert_eq!(format_utc(sample()), "2026-10-02T01:08:00Z");
    }

    #[test]
    fn format_utc_drops_sub_second_precision() {
        let dt = sample() + chrono::Duration::milliseconds(789);
        assert_eq!(format_utc(dt), "2026-10-02T01:08:00Z");
    }

    #[test]
    fn parse_utc_accepts_z_suffixed_rfc3339() {
        assert_eq!(parse_utc("2026-10-02T01:08:00Z").unwrap(), sample());
    }

    #[test]
    fn parse_utc_rejects_offsets_and_garbage() {
        assert!(parse_utc("2026-10-02T10:08:00+09:00").is_err());
        assert!(parse_utc("2026-10-02T01:08:00+00:00").is_err());
        assert!(parse_utc("2026-10-02 01:08:00").is_err());
        assert!(parse_utc("2026-10-02T01:08:00").is_err());
        assert!(parse_utc("2026-10-02T01:08:00z").is_err());
        assert!(parse_utc("not a date").is_err());
        assert!(parse_utc("").is_err());
    }

    #[test]
    fn format_and_parse_round_trip() {
        assert_eq!(parse_utc(&format_utc(sample())).unwrap(), sample());
    }

    #[test]
    fn fixed_clock_returns_its_instant() {
        assert_eq!(FixedClock(sample()).now(), sample());
    }

    #[test]
    fn system_clock_is_close_to_now() {
        let before = Utc::now();
        let now = SystemClock.now();
        let after = Utc::now();
        assert!(before <= now && now <= after);
    }

    #[test]
    fn local_short_formats_month_day_hour_minute() {
        // Tests run with TZ=UTC (see RUNTIME.md).
        assert_eq!(format_local_short(sample()), "10/02 01:08");
    }

    #[test]
    fn serde_adapter_round_trips_through_json() {
        #[derive(serde::Serialize, serde::Deserialize, PartialEq, Debug)]
        struct Wrap(#[serde(with = "serde_utc")] DateTime<Utc>);
        let json = serde_json::to_string(&Wrap(sample())).unwrap();
        assert_eq!(json, "\"2026-10-02T01:08:00Z\"");
        assert_eq!(serde_json::from_str::<Wrap>(&json).unwrap(), Wrap(sample()));
        assert!(serde_json::from_str::<Wrap>("\"2026-10-02T10:08:00+09:00\"").is_err());
    }
}
