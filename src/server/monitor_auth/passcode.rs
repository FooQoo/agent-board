//! The four-digit passcode that opens the phone monitor for one start of the
//! connection, and the limit on wrong guesses.
//!
//! The passcode is made from the operating system's random source each time the
//! connection starts and lives in memory only. It is shown on the PC (the
//! `serve` startup line and the connection dialog) and nowhere else: never in a
//! log, a file, a page, a `GET` answer other than the PC's status, or an error.
//! Four digits are only 10,000 possibilities, so the guesses are counted: after
//! [`MAX_FAILURES`] wrong ones in a row nothing opens the monitor again until the
//! connection is started anew, which also makes a new passcode.

use std::fmt;
use std::sync::Mutex;

use serde::{Serialize, Serializer};

use super::contracts::constant_time_eq;

/// How many digits the passcode has.
pub const PASSCODE_DIGITS: usize = 4;

/// Wrong passcodes in a row after which the passcode is refused for good.
pub const MAX_FAILURES: u32 = 5;

/// The passcode of one start. `Debug` never shows it.
#[derive(Clone, PartialEq, Eq)]
pub struct Passcode(String);

impl fmt::Debug for Passcode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Passcode(<redacted>)")
    }
}

impl Serialize for Passcode {
    /// Only the PC's own status carries a passcode, and only while it is in use.
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl Passcode {
    /// A fresh passcode, `0000` to `9999` with equal chance each. A value from
    /// the random source is dropped when it would make some passcodes likelier
    /// than others, instead of folding it in.
    pub fn generate() -> std::io::Result<Self> {
        const SPAN: u32 = 10u32.pow(PASSCODE_DIGITS as u32);
        // The largest multiple of SPAN that fits in sixteen bits.
        const LIMIT: u32 = (u16::MAX as u32 + 1) / SPAN * SPAN;
        loop {
            let mut bytes = [0u8; 2];
            getrandom::fill(&mut bytes).map_err(|e| std::io::Error::other(e.to_string()))?;
            let value = u32::from(u16::from_le_bytes(bytes));
            if value < LIMIT {
                return Ok(Self::from_number(value % SPAN));
            }
        }
    }

    /// The passcode for a number below 10,000, with leading zeros (used by tests).
    pub fn from_number(number: u32) -> Self {
        Self(format!(
            "{:0width$}",
            number % 10_000,
            width = PASSCODE_DIGITS
        ))
    }

    /// The digits. Show them on the PC only.
    pub fn expose(&self) -> &str {
        &self.0
    }

    /// Whether `attempt` is this passcode, compared in constant time.
    pub fn matches(&self, attempt: &str) -> bool {
        constant_time_eq(self.0.as_bytes(), attempt.as_bytes())
    }
}

/// What came of one attempt to open the monitor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unlock {
    /// The passcode was right and the count of wrong guesses starts again.
    Granted,
    /// The passcode was wrong. Nothing says how many tries are left.
    Wrong,
    /// Too many wrong guesses: even the right passcode is refused now.
    Locked,
}

/// The passcode of one start together with the count of wrong guesses against it.
pub struct UnlockGate {
    code: Passcode,
    failures: Mutex<u32>,
}

impl UnlockGate {
    pub fn new(code: Passcode) -> Self {
        Self {
            code,
            failures: Mutex::new(0),
        }
    }

    /// Try `attempt`. Checking and counting happen under one lock, so a burst
    /// of guesses cannot get past the limit.
    pub fn try_unlock(&self, attempt: &str) -> Unlock {
        // Always compared, so a locked gate answers as fast as an open one.
        let right = self.code.matches(attempt);
        let mut failures = self.failures.lock().unwrap_or_else(|e| e.into_inner());
        if *failures >= MAX_FAILURES {
            Unlock::Locked
        } else if right {
            *failures = 0;
            Unlock::Granted
        } else {
            *failures += 1;
            Unlock::Wrong
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_passcode_is_four_digits_with_leading_zeros_and_is_never_printed() {
        assert_eq!(Passcode::from_number(7).expose(), "0007");
        assert_eq!(Passcode::from_number(9999).expose(), "9999");
        assert_eq!(Passcode::from_number(12_345).expose(), "2345");
        let code = Passcode::from_number(4821);
        assert_eq!(format!("{code:?}"), "Passcode(<redacted>)");
        assert!(!format!("{code:?}").contains("4821"));
    }

    #[test]
    fn generated_passcodes_are_four_digits_and_differ_from_start_to_start() {
        let codes: Vec<String> = (0..200)
            .map(|_| Passcode::generate().unwrap().expose().to_string())
            .collect();
        assert!(codes.iter().all(|code| {
            code.len() == PASSCODE_DIGITS && code.bytes().all(|b| b.is_ascii_digit())
        }));
        // 200 draws from 10,000 values: a repeated single value would be a broken source.
        let distinct: std::collections::HashSet<&String> = codes.iter().collect();
        assert!(distinct.len() > 150, "only {} distinct", distinct.len());
    }

    #[test]
    fn the_right_passcode_opens_and_a_wrong_one_does_not() {
        // A fresh gate for each, so that no guess runs into the limit.
        for wrong in [
            "",
            "1",
            "123",
            "12345",
            "1235",
            " 1234",
            "1234 ",
            "1234\n",
            "１２３４",
        ] {
            let gate = UnlockGate::new(Passcode::from_number(1234));
            assert_eq!(gate.try_unlock(wrong), Unlock::Wrong, "{wrong:?}");
            assert_eq!(gate.try_unlock("1234"), Unlock::Granted);
        }
    }

    #[test]
    fn five_wrong_guesses_in_a_row_lock_even_the_right_passcode() {
        let gate = UnlockGate::new(Passcode::from_number(1234));
        for _ in 0..MAX_FAILURES {
            assert_eq!(gate.try_unlock("0000"), Unlock::Wrong);
        }
        assert_eq!(gate.try_unlock("1234"), Unlock::Locked);
        assert_eq!(gate.try_unlock("0000"), Unlock::Locked);
        assert_eq!(gate.try_unlock("1234"), Unlock::Locked);
    }

    #[test]
    fn a_success_starts_the_count_again() {
        let gate = UnlockGate::new(Passcode::from_number(1234));
        for _ in 0..MAX_FAILURES - 1 {
            assert_eq!(gate.try_unlock("0000"), Unlock::Wrong);
        }
        assert_eq!(gate.try_unlock("1234"), Unlock::Granted);
        for _ in 0..MAX_FAILURES - 1 {
            assert_eq!(gate.try_unlock("0000"), Unlock::Wrong);
        }
        assert_eq!(gate.try_unlock("1234"), Unlock::Granted);
    }

    #[test]
    fn concurrent_guesses_cannot_get_past_the_limit() {
        let gate = std::sync::Arc::new(UnlockGate::new(Passcode::from_number(1234)));
        let wrongs: Vec<_> = (0..32)
            .map(|_| {
                let gate = gate.clone();
                std::thread::spawn(move || gate.try_unlock("0000"))
            })
            .collect();
        let results: Vec<Unlock> = wrongs.into_iter().map(|h| h.join().unwrap()).collect();
        assert_eq!(
            results.iter().filter(|r| **r == Unlock::Wrong).count(),
            MAX_FAILURES as usize
        );
        assert_eq!(gate.try_unlock("1234"), Unlock::Locked);
    }

    #[test]
    fn serializing_gives_the_digits_only() {
        let value = serde_json::to_value(Passcode::from_number(42)).unwrap();
        assert_eq!(value, serde_json::json!("0042"));
    }
}
