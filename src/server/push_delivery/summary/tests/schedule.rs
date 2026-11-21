use super::super::*;
use chrono::TimeZone;

fn utc_at(day: u32, hour: u32, minute: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, day, hour, minute, 0)
        .unwrap()
}

fn zone(hours: i32, minutes: i32) -> chrono::FixedOffset {
    let secs = hours * 3600 + hours.signum() * minutes * 60;
    chrono::FixedOffset::east_opt(secs).unwrap()
}

#[test]
fn boundaries_fall_on_the_hour_in_utc() {
    let utc = Utc;
    assert_eq!(clock_floor(utc_at(2, 10, 59), 60, &utc), utc_at(2, 10, 0));
    assert_eq!(clock_floor(utc_at(2, 11, 0), 60, &utc), utc_at(2, 11, 0));
    assert_eq!(clock_floor(utc_at(2, 10, 59), 30, &utc), utc_at(2, 10, 30));
    assert_eq!(clock_floor(utc_at(2, 10, 7), 120, &utc), utc_at(2, 10, 0));
    assert_eq!(clock_floor(utc_at(2, 11, 7), 120, &utc), utc_at(2, 10, 0));
    assert_eq!(clock_floor(utc_at(2, 11, 59), 240, &utc), utc_at(2, 8, 0));
    assert_eq!(clock_floor(utc_at(2, 12, 0), 240, &utc), utc_at(2, 12, 0));
}

#[test]
fn boundaries_follow_the_local_clock_not_utc() {
    // 09:30 in Tokyo is 00:30 UTC: four hours back from there is 08:00 Tokyo, 23:00 UTC the day before.
    let tokyo = zone(9, 0);
    assert_eq!(clock_floor(utc_at(2, 0, 30), 240, &tokyo), utc_at(1, 23, 0));
    // A zone with a half-hour offset still lands on its own hours.
    let india = zone(5, 30);
    assert_eq!(clock_floor(utc_at(2, 10, 10), 60, &india), utc_at(2, 9, 30));
    // A zone west of UTC.
    let new_york = zone(-5, 0);
    assert_eq!(
        clock_floor(utc_at(2, 3, 59), 240, &new_york),
        utc_at(2, 1, 0)
    );
}

#[test]
fn a_day_boundary_is_a_boundary_of_every_interval() {
    let tokyo = zone(9, 0);
    // 00:00 Tokyo on the 2nd is 15:00 UTC on the 1st.
    let midnight = utc_at(1, 15, 0);
    for minutes in [30, 60, 120, 240] {
        assert_eq!(clock_floor(midnight, minutes, &tokyo), midnight);
        let before = midnight - chrono::Duration::seconds(1);
        let end = clock_floor(before, minutes, &tokyo);
        assert_eq!(
            end,
            midnight - chrono::Duration::minutes(i64::from(minutes))
        );
    }
}

#[test]
fn the_first_window_ends_on_the_next_boundary_and_covers_the_one_before_the_start() {
    let utc = Utc;
    let schedule = Schedule::new(utc_at(2, 10, 17), None);
    assert_eq!(schedule.due_in(utc_at(2, 10, 59), 60, &utc), None);
    assert_eq!(
        schedule.due_in(utc_at(2, 11, 0), 60, &utc),
        Some(utc_at(2, 11, 0))
    );
    // It starts one boundary before the one the server started in, as before the change.
    assert_eq!(schedule.since_in(60, &utc), utc_at(2, 9, 0));
}

#[test]
fn a_server_started_on_a_boundary_waits_for_the_next_one() {
    let utc = Utc;
    let schedule = Schedule::new(utc_at(2, 10, 0), None);
    assert_eq!(schedule.due_in(utc_at(2, 10, 30), 60, &utc), None);
    assert_eq!(
        schedule.due_in(utc_at(2, 11, 0), 60, &utc),
        Some(utc_at(2, 11, 0))
    );
}

#[test]
fn a_marked_window_starts_the_next_one_where_it_ended() {
    let utc = Utc;
    let mut schedule = Schedule::new(utc_at(2, 10, 0), None);
    schedule.mark(utc_at(2, 11, 0));
    assert_eq!(schedule.since_in(30, &utc), utc_at(2, 11, 0));
    assert_eq!(schedule.due_in(utc_at(2, 11, 29), 30, &utc), None);
    assert_eq!(
        schedule.due_in(utc_at(2, 11, 30), 30, &utc),
        Some(utc_at(2, 11, 30))
    );
}

#[test]
fn a_late_check_still_ends_the_window_on_the_boundary_and_a_missed_one_is_merged() {
    let utc = Utc;
    let mut schedule = Schedule::new(utc_at(2, 10, 0), None);
    schedule.mark(utc_at(2, 11, 0));
    // The task slept past 12:00 and 13:00: one window ends on 13:00, starting at 11:00.
    assert_eq!(
        schedule.due_in(utc_at(2, 13, 4), 60, &utc),
        Some(utc_at(2, 13, 0))
    );
    assert_eq!(schedule.since_in(60, &utc), utc_at(2, 11, 0));
}

#[test]
fn windows_chain_across_midnight_without_drift() {
    let tokyo = zone(9, 0);
    let mut schedule = Schedule::new(utc_at(1, 14, 10), None);
    let mut ends = Vec::new();
    let mut now = utc_at(1, 14, 10);
    while ends.len() < 4 {
        now += chrono::Duration::seconds(30);
        if let Some(end) = schedule.due_in(now, 120, &tokyo) {
            ends.push(end);
            schedule.mark(end);
        }
    }
    // 23:10 Tokyo start: 00:00, 02:00, 04:00, 06:00 on the 2nd.
    let local: Vec<String> = ends
        .iter()
        .map(|e| e.with_timezone(&tokyo).format("%d %H:%M").to_string())
        .collect();
    assert_eq!(local, ["02 00:00", "02 02:00", "02 04:00", "02 06:00"]);
}

#[test]
fn restarting_counts_from_the_new_start() {
    let utc = Utc;
    let mut schedule = Schedule::new(utc_at(2, 10, 0), None);
    schedule.mark(utc_at(2, 11, 0));
    schedule.restart(utc_at(2, 15, 20));
    assert_eq!(schedule.due_in(utc_at(2, 15, 59), 60, &utc), None);
    assert_eq!(
        schedule.due_in(utc_at(2, 16, 0), 60, &utc),
        Some(utc_at(2, 16, 0))
    );
}
