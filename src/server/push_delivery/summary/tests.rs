use super::*;
use crate::file_store::notify::SummaryResult;
use chrono::TimeZone;

const PROJECT: &str = "0123456789abcdef0123456789abcdef";

fn at(hour: u32, minute: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 2, hour, minute, 0).unwrap()
}

fn origin() -> PublicOrigin {
    PublicOrigin::parse("https://board.example.dev").unwrap()
}

fn summary(titles: &[&str]) -> Summary {
    Summary {
        id: "s-20261102T110000Z".into(),
        dismissed: false,
        from: at(10, 0),
        to: at(11, 0),
        results: titles
            .iter()
            .map(|t| SummaryResult {
                task_id: 3,
                title: (*t).into(),
                at: at(10, 30),
            })
            .collect(),
    }
}

#[test]
fn the_message_counts_the_results_and_lists_the_first_titles() {
    let p = payload_of(
        PROJECT,
        &summary(&["A", "B", "C", "D", "E"]),
        Lang::En,
        &origin(),
    )
    .unwrap();
    assert!(p.title.starts_with("Summary "));
    assert_eq!(p.body, "5 results: A; B; C; and 2 more");
    assert_eq!(p.path, format!("/?project={PROJECT}&messages=summary"));
    assert_eq!(p.tag, format!("summary:{PROJECT}:s-20261102T110000Z"));
    assert!(!p.urgent);
    let one = payload_of(PROJECT, &summary(&["Only"]), Lang::En, &origin()).unwrap();
    assert_eq!(one.body, "1 result: Only");
    let ja = payload_of(
        PROJECT,
        &summary(&["A", "B", "C", "D"]),
        Lang::Ja,
        &origin(),
    )
    .unwrap();
    assert!(ja.title.starts_with("サマリー "));
    assert_eq!(ja.body, "成果が4件: A、B、C、ほか1件");
    assert!(payload_of("not-an-id", &summary(&["A"]), Lang::En, &origin()).is_none());
}

#[test]
fn recording_continues_from_the_newest_stored_summary_and_skips_an_empty_window() {
    use crate::domain::{Actor, Assignee, NewTask, ResultKind};
    use crate::file_store::ResultInput;
    let root = tempfile::tempdir().unwrap();
    let store = FileStore::open(&root.path().join("shared"));
    let project = store.create_project("Alpha", at(0, 0)).unwrap().id;
    let task = store
        .create_task(
            &project,
            NewTask {
                title: "T".into(),
                description: String::new(),
                assignee: Assignee::Ai,
                actor: Actor::Human,
                draft: None,
            },
            at(0, 0),
        )
        .unwrap()
        .id;
    let add = |title: &str, when| {
        store
            .add_result(
                &project,
                task,
                ResultInput {
                    kind: ResultKind::Progress,
                    title: Some(title.into()),
                    summary: format!("{title}."),
                    link: None,
                    images: Vec::new(),
                    key: None,
                },
                when,
            )
            .unwrap();
    };
    let tasks = |store: &FileStore| store.snapshot(&project).unwrap().tasks;

    add("One", at(10, 20));
    let first = record(&store, &project, &tasks(&store), at(10, 0), at(11, 0))
        .unwrap()
        .unwrap();
    assert_eq!(first.results.len(), 1);
    // The same window again, or a window with nothing new, writes nothing.
    assert!(
        record(&store, &project, &tasks(&store), at(10, 0), at(11, 0))
            .unwrap()
            .is_none()
    );
    assert!(
        record(&store, &project, &tasks(&store), at(11, 0), at(12, 0))
            .unwrap()
            .is_none()
    );
    // A floor older than the stored end does not report "One" again.
    add("Two", at(12, 30));
    let next = record(&store, &project, &tasks(&store), at(9, 0), at(13, 0))
        .unwrap()
        .unwrap();
    assert_eq!(next.from, at(11, 0));
    assert_eq!(next.results.len(), 1);
    assert_eq!(next.results[0].title, "Two");
    assert_eq!(store.summaries(&project).unwrap().len(), 2);
}

#[test]
fn a_result_saved_just_before_the_end_of_a_window_is_in_its_summary() {
    use crate::domain::{Actor, Assignee, NewTask, ResultKind};
    use crate::file_store::ResultInput;
    let root = tempfile::tempdir().unwrap();
    let store = FileStore::open(&root.path().join("shared"));
    let project = store.create_project("Alpha", at(0, 0)).unwrap().id;
    let task = store
        .create_task(
            &project,
            NewTask {
                title: "T".into(),
                description: String::new(),
                assignee: Assignee::Ai,
                actor: Actor::Human,
                draft: None,
            },
            at(0, 0),
        )
        .unwrap()
        .id;
    // A copy of the tasks as an index that has not caught up would hold them.
    let stale = store.snapshot(&project).unwrap().tasks;
    store
        .add_result(
            &project,
            task,
            ResultInput {
                kind: ResultKind::Progress,
                title: Some("Late".into()),
                summary: "Late.".into(),
                link: None,
                images: Vec::new(),
                key: None,
            },
            at(10, 59),
        )
        .unwrap();
    assert!(
        Summary::for_window(&stale, at(10, 0), at(11, 0)).is_none(),
        "the stale copy misses the result"
    );
    let summary = record_from_files(&store, &project, at(10, 0), at(11, 0))
        .unwrap()
        .unwrap();
    assert_eq!(summary.results[0].title, "Late");
}

mod schedule;
mod window;
