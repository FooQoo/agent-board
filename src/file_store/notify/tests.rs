use super::*;
use crate::domain::{Actor, Assignee, NewTask, ResultKind};
use crate::file_store::ResultInput;
use chrono::TimeZone;

fn at(day: u32, hour: u32, minute: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, day, hour, minute, 0)
        .unwrap()
}

struct Fixture {
    _root: tempfile::TempDir,
    store: FileStore,
    project: ProjectId,
}

fn fixture() -> Fixture {
    let root = tempfile::tempdir().unwrap();
    let store = FileStore::open(&root.path().join("shared"));
    let project = store.create_project("Alpha", at(1, 0, 0)).unwrap().id;
    Fixture {
        _root: root,
        store,
        project,
    }
}

impl Fixture {
    fn task(&self, title: &str) -> i64 {
        self.store
            .create_task(
                &self.project,
                NewTask {
                    title: title.into(),
                    description: String::new(),
                    assignee: Assignee::Ai,
                    actor: Actor::Human,
                    draft: None,
                },
                at(1, 0, 0),
            )
            .unwrap()
            .id
    }

    fn result(&self, task: i64, title: &str, when: DateTime<Utc>) {
        self.store
            .add_result(
                &self.project,
                task,
                ResultInput {
                    kind: ResultKind::Progress,
                    title: Some(title.into()),
                    summary: format!("{title} is done."),
                    link: None,
                    images: Vec::new(),
                    key: None,
                },
                when,
            )
            .unwrap();
    }

    fn tasks(&self) -> Vec<TaskView> {
        self.store.snapshot(&self.project).unwrap().tasks
    }

    fn dir(&self) -> PathBuf {
        layout::project_dir(self.store.shared_dir(), &self.project).join(NOTIFY_DIR)
    }
}

fn summary(to: DateTime<Utc>, titles: &[&str]) -> Summary {
    Summary {
        id: format!("s-{}", to.format("%Y%m%dT%H%M%SZ")),
        dismissed: false,
        from: to - chrono::Duration::hours(1),
        to,
        results: titles
            .iter()
            .map(|t| SummaryResult {
                task_id: 1,
                title: (*t).into(),
                at: to - chrono::Duration::minutes(5),
            })
            .collect(),
    }
}

#[test]
fn a_window_lists_the_results_recorded_in_it_across_tasks() {
    let f = fixture();
    let (a, b) = (f.task("A"), f.task("B"));
    f.result(a, "Before the window", at(2, 9, 0));
    f.result(a, "First", at(2, 10, 10));
    f.result(b, "Second", at(2, 10, 40));
    f.result(b, "After the window", at(2, 11, 30));
    let s = Summary::for_window(&f.tasks(), at(2, 10, 0), at(2, 11, 0)).unwrap();
    assert_eq!(s.id, "s-20261102T110000Z");
    assert!(!s.dismissed);
    let titles: Vec<_> = s
        .results
        .iter()
        .map(|r| (r.task_id, r.title.as_str()))
        .collect();
    assert_eq!(titles, [(a, "First"), (b, "Second")]);
}

#[test]
fn a_window_with_no_result_has_no_summary_and_writes_nothing() {
    let f = fixture();
    let a = f.task("A");
    f.result(a, "Early", at(2, 9, 0));
    assert!(Summary::for_window(&f.tasks(), at(2, 10, 0), at(2, 11, 0)).is_none());
    assert!(!f.dir().exists());
}

#[test]
fn a_summary_is_appended_to_the_file_of_the_day_its_window_ends() {
    let f = fixture();
    assert!(
        f.store
            .append_summary(&f.project, &summary(at(2, 11, 0), &["a"]))
            .unwrap()
    );
    assert!(
        f.store
            .append_summary(&f.project, &summary(at(2, 12, 0), &["b"]))
            .unwrap()
    );
    assert!(
        f.store
            .append_summary(&f.project, &summary(at(3, 1, 0), &["c"]))
            .unwrap()
    );
    let day = std::fs::read_to_string(f.dir().join("2026-11-02.ldjson")).unwrap();
    assert_eq!(day.lines().count(), 2);
    assert!(day.ends_with('\n'));
    let line: serde_json::Value = serde_json::from_str(day.lines().next().unwrap()).unwrap();
    assert_eq!(line["id"], "s-20261102T110000Z");
    assert_eq!(line["dismissed"], false);
    assert_eq!(line["from"], "2026-11-02T10:00:00Z");
    assert_eq!(line["to"], "2026-11-02T11:00:00Z");
    assert_eq!(line["results"][0]["title"], "a");
    assert!(f.dir().join("2026-11-03.ldjson").is_file());
    let ids: Vec<_> = f
        .store
        .summaries(&f.project)
        .unwrap()
        .into_iter()
        .map(|s| s.id)
        .collect();
    assert_eq!(
        ids,
        [
            "s-20261103T010000Z",
            "s-20261102T120000Z",
            "s-20261102T110000Z"
        ]
    );
}

#[test]
fn writing_a_window_twice_writes_it_once() {
    let f = fixture();
    let s = summary(at(2, 11, 0), &["a"]);
    assert!(f.store.append_summary(&f.project, &s).unwrap());
    assert!(!f.store.append_summary(&f.project, &s).unwrap());
    assert_eq!(f.store.summaries(&f.project).unwrap().len(), 1);
    assert_eq!(f.store.latest_summary_end(&f.project), Some(at(2, 11, 0)));
}

#[test]
fn dismissing_sets_the_flag_on_that_line_only_and_keeps_every_line() {
    let f = fixture();
    f.store
        .append_summary(&f.project, &summary(at(2, 11, 0), &["a"]))
        .unwrap();
    f.store
        .append_summary(&f.project, &summary(at(2, 12, 0), &["b"]))
        .unwrap();
    let path = f.dir().join("2026-11-02.ldjson");
    let text = std::fs::read_to_string(&path).unwrap();
    let edited = text.replacen(
        "\"dismissed\":false",
        "\"dismissed\":false,\"note\":\"keep\"",
        1,
    );
    std::fs::write(&path, &edited).unwrap();

    let dismissed = f
        .store
        .dismiss_summary(&f.project, "s-20261102T110000Z")
        .unwrap();
    assert!(dismissed.dismissed);
    let after = std::fs::read_to_string(&path).unwrap();
    let lines: Vec<_> = after.lines().collect();
    assert_eq!(lines.len(), 2);
    assert!(lines[0].contains("\"dismissed\":true") && lines[0].contains("\"note\":\"keep\""));
    assert_eq!(lines[1], edited.lines().nth(1).unwrap());

    // Dismissed summaries are still listed by the store, and dismissing again changes nothing.
    let listed = f.store.summaries(&f.project).unwrap();
    assert!(!listed[0].dismissed && listed[1].dismissed);
    assert!(
        f.store
            .dismiss_summary(&f.project, "s-20261102T110000Z")
            .unwrap()
            .dismissed
    );
    assert_eq!(std::fs::read_to_string(&path).unwrap(), after);
    assert_eq!(f.store.latest_summary_end(&f.project), Some(at(2, 12, 0)));
    assert!(matches!(
        f.store.dismiss_summary(&f.project, "nope"),
        Err(AgboardError::MessageNotFound { .. })
    ));
}

#[test]
fn hand_edits_are_reflected_and_unreadable_lines_are_kept() {
    let f = fixture();
    f.store
        .append_summary(&f.project, &summary(at(2, 11, 0), &["a"]))
        .unwrap();
    let path = f.dir().join("2026-11-02.ldjson");
    let good = std::fs::read_to_string(&path).unwrap();
    // A hand-written line without `dismissed`, a broken line, a blank line, and stray files.
    let hand =
        r#"{"id":"hand","from":"2026-11-02T00:00:00Z","to":"2026-11-02T05:00:00Z","results":[]}"#;
    std::fs::write(&path, format!("{good}not json\n\n{hand}")).unwrap();
    std::fs::write(f.dir().join("notes.txt"), "ignored").unwrap();
    std::fs::write(f.dir().join(".2026-11-02.ldjson.tmp-1"), "ignored").unwrap();

    let listed = f.store.summaries(&f.project).unwrap();
    let ids: Vec<_> = listed.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(ids, ["s-20261102T110000Z", "hand"]);
    assert!(!listed[1].dismissed);

    // Setting the flag by hand is reflected.
    let flagged = std::fs::read_to_string(&path)
        .unwrap()
        .replace("\"id\":\"hand\"", "\"id\":\"hand\",\"dismissed\":true");
    std::fs::write(&path, flagged).unwrap();
    assert!(f.store.summaries(&f.project).unwrap()[1].dismissed);

    // Dismissing another line keeps the line that cannot be read.
    f.store
        .dismiss_summary(&f.project, "s-20261102T110000Z")
        .unwrap();
    let kept = std::fs::read_to_string(&path).unwrap();
    assert!(kept.contains("not json"));
    assert_eq!(kept.lines().count(), 3);

    // Deleting the file by hand empties the list.
    std::fs::remove_file(&path).unwrap();
    assert!(f.store.summaries(&f.project).unwrap().is_empty());
}

#[test]
fn a_project_that_does_not_exist_is_not_found() {
    let f = fixture();
    let other: ProjectId = "0123456789abcdef0123456789abcdef".parse().unwrap();
    assert!(matches!(
        f.store.summaries(&other),
        Err(AgboardError::ProjectNotFound { .. })
    ));
}
