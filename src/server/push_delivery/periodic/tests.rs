use super::*;

const PROJECT: &str = "0123456789abcdef0123456789abcdef";
const OTHER: &str = "fedcba9876543210fedcba9876543210";
const NOW: i64 = 1_800_000_000;

fn at(seconds: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(NOW + seconds, 0).unwrap()
}

fn origin() -> PublicOrigin {
    PublicOrigin::parse("https://board.example.dev").unwrap()
}

fn card(id: i64, status: Column, run: RunState, records: &[(i64, &str)]) -> Facts {
    Facts {
        id,
        title: format!("Card {id}"),
        status,
        run,
        open_questions: Vec::new(),
        question: None,
        results: Vec::new(),
        history: Vec::new(),
        records: records
            .iter()
            .map(|(s, text)| Record {
                at: NOW + s,
                text: (*text).to_string(),
            })
            .collect(),
        status_changed_at: NOW,
        run_changed_at: NOW,
        updated_at: NOW,
    }
}

fn known(project: &str, cards: Vec<Facts>) -> HashMap<String, ProjectFacts> {
    let facts: ProjectFacts = cards.into_iter().map(|c| (c.id, c)).collect();
    HashMap::from([(project.to_string(), facts)])
}

#[test]
fn the_interval_counts_from_the_last_report_or_the_start() {
    let mut schedule = Schedule::new(at(0), None);
    assert!(!schedule.due(at(59 * 60), 60));
    assert!(schedule.due(at(60 * 60), 60));
    // A shorter interval is due sooner, a longer one later: the setting is read each time.
    assert!(schedule.due(at(30 * 60), 30));
    assert!(!schedule.due(at(60 * 60), 120));
    // The first report looks back one interval.
    assert_eq!(schedule.since(60), at(-3600));
    schedule.mark(at(3600));
    assert!(!schedule.due(at(2 * 3600 - 1), 60));
    assert!(schedule.due(at(2 * 3600), 60));
    assert_eq!(schedule.since(60), at(3600));
    // A report that was made before a restart is the starting point after it.
    let restarted = Schedule::new(at(10_000), Some(at(9_000)));
    assert!(!restarted.due(at(10_000), 60));
    assert_eq!(restarted.since(60), at(9_000));
}

#[test]
fn new_records_are_counted_and_the_latest_is_quoted() {
    let cards = vec![card(
        12,
        Column::Doing,
        RunState::Idle,
        &[
            (-7200, "Old note"),
            (-60, "Wrote the draft"),
            (-30, "Checked it"),
        ],
    )];
    let p = report(&known(PROJECT, cards), at(-3600), Lang::En, &origin()).unwrap();
    assert_eq!(p.title, "Work in progress: 1 card");
    assert!(p.body.starts_with("#12 Card 12: 2 new records. Latest "));
    assert!(p.body.ends_with("Checked it"));
    assert_eq!(p.path, format!("/?project={PROJECT}&task=12"));
    assert_eq!(p.tag, TAG);
    assert!(!p.urgent);
}

#[test]
fn without_a_new_record_it_says_so_with_the_last_update_and_does_not_claim_activity() {
    let cards = vec![card(
        7,
        Column::Doing,
        RunState::Idle,
        &[(-7200, "Started on the layout")],
    )];
    let p = report(&known(PROJECT, cards), at(-3600), Lang::En, &origin()).unwrap();
    assert!(
        p.body
            .starts_with("#7 Card 7: no new record since the last report. Last update ")
    );
    assert!(p.body.ends_with(": Started on the layout"));
    let lower = p.body.to_lowercase();
    for claim in ["running", "active", "still", "working", "in progress"] {
        assert!(!lower.contains(claim), "{claim}: {}", p.body);
    }
}

#[test]
fn the_run_state_is_mentioned_only_when_the_board_holds_it_and_as_a_self_report() {
    let cards = vec![
        card(1, Column::Doing, RunState::Running, &[(-7200, "Old")]),
        card(2, Column::Doing, RunState::Pending, &[]),
    ];
    let p = report(&known(PROJECT, cards), at(-3600), Lang::En, &origin()).unwrap();
    let lines: Vec<&str> = p.body.lines().collect();
    assert!(lines[0].ends_with("The agent reports it is running (self-report)."));
    assert_eq!(
        lines[1],
        "#2 Card 2: no record yet. Waiting for your answer."
    );
    // And in Japanese.
    let ja = report(
        &known(
            PROJECT,
            vec![card(
                1,
                Column::Doing,
                RunState::Running,
                &[(-60, "進めた")],
            )],
        ),
        at(-3600),
        Lang::Ja,
        &origin(),
    )
    .unwrap();
    assert_eq!(ja.title, "進行中の作業: 1件");
    assert!(ja.body.contains("新しい記録が1件"));
    assert!(
        ja.body
            .ends_with("エージェントは実行中と自己申告しています。")
    );
}

#[test]
fn only_cards_in_doing_are_reported_and_nothing_is_sent_when_there_are_none() {
    let cards = vec![
        card(1, Column::Todo, RunState::Idle, &[(-60, "x")]),
        card(2, Column::Done, RunState::Idle, &[(-60, "x")]),
    ];
    assert_eq!(
        report(&known(PROJECT, cards), at(-3600), Lang::En, &origin()),
        None
    );
    assert_eq!(
        report(&HashMap::new(), at(-3600), Lang::En, &origin()),
        None
    );
}

#[test]
fn the_link_and_the_list_follow_how_many_cards_and_projects_there_are() {
    let doing = |id| card(id, Column::Doing, RunState::Idle, &[(-60, "x")]);
    let one_project = known(PROJECT, vec![doing(1), doing(2)]);
    let p = report(&one_project, at(-3600), Lang::En, &origin()).unwrap();
    assert_eq!(p.title, "Work in progress: 2 cards");
    assert_eq!(p.path, format!("/?project={PROJECT}"));

    let mut two = one_project;
    two.extend(known(OTHER, vec![doing(3)]));
    assert_eq!(
        report(&two, at(-3600), Lang::En, &origin()).unwrap().path,
        "/"
    );

    let many = known(PROJECT, (1..=8).map(doing).collect());
    let p = report(&many, at(-3600), Lang::En, &origin()).unwrap();
    assert_eq!(p.body.lines().count(), MAX_CARDS + 1);
    assert_eq!(p.body.lines().last(), Some("and 3 more"));
}
