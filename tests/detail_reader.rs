//! The Detail reader: the events built from one project snapshot (U4). The snapshot is read with
//! `FileStore::snapshot`; the shared folder is a temporary one.

use std::io::Cursor;
use std::path::Path;

use agent_board::domain::{Actor, Assignee, AttachmentInput, NewTask, ProjectId};
use agent_board::error::AgboardError;
use agent_board::file_store::detail::{DetailSnapshot, epic_version, task_versions};
use agent_board::file_store::model::{AttachmentOwner, NewEpic};
use agent_board::file_store::validate::EpicId;
use agent_board::file_store::{FileStore, TaskTextParts};
use agent_board::server::contracts::{
    BlockKind, DetailEvent, DetailResource, ResourceId, Section, StreamValidator,
};
use chrono::{TimeZone, Utc};
use image::{DynamicImage, ImageFormat, RgbaImage};

fn at(minute: u32) -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 22, 9, minute, 0).unwrap()
}

struct World {
    _dir: tempfile::TempDir,
    store: FileStore,
    project: ProjectId,
}

impl World {
    fn new() -> World {
        let dir = tempfile::tempdir().unwrap();
        let store = FileStore::open(&dir.path().join("shared"));
        let project = store.create_project("Demo", at(0)).unwrap().id;
        World {
            _dir: dir,
            store,
            project,
        }
    }

    fn task(&self, body: &str) -> i64 {
        self.store
            .create_task(
                &self.project,
                NewTask {
                    title: "Task".into(),
                    description: body.into(),
                    assignee: Assignee::Ai,
                    actor: Actor::Ai,
                    is_draft: false,
                },
                at(1),
            )
            .unwrap()
            .id
    }

    fn epic(&self, id: &str, document: &str) -> EpicId {
        self.store
            .create_epic(
                &self.project,
                NewEpic {
                    id: id.into(),
                    name: "Epic".into(),
                    color: Some("#7C3AED".into()),
                    is_draft: false,
                    document: Some(document.into()),
                },
                at(2),
            )
            .unwrap()
            .id
    }

    fn snapshot(&self) -> agent_board::file_store::reader::ProjectSnapshot {
        self.store.snapshot(&self.project).unwrap()
    }

    fn shared(&self) -> &Path {
        self.store.shared_dir()
    }

    fn png(&self, owner: &AttachmentOwner, id: &str, width: u32, height: u32) {
        let image = DynamicImage::ImageRgba8(RgbaImage::new(width, height));
        let mut out = Cursor::new(Vec::new());
        image.write_to(&mut out, ImageFormat::Png).unwrap();
        self.store
            .add_attachment(
                &self.project,
                owner,
                AttachmentInput {
                    id: id.into(),
                    name: "pic.png".into(),
                    bytes: out.into_inner(),
                },
                at(3),
            )
            .unwrap();
    }
}

const BOTH: [Section; 2] = [Section::Document, Section::History];

fn validate(events: &[DetailEvent]) {
    let mut checker = StreamValidator::new();
    for event in events {
        checker
            .accept(event)
            .unwrap_or_else(|e| panic!("{e}: {event:?}"));
    }
    checker.finish().unwrap();
}

fn types(events: &[DetailEvent]) -> Vec<&'static str> {
    events
        .iter()
        .map(|e| match e {
            DetailEvent::Start { .. } => "start",
            DetailEvent::SectionStart { .. } => "section-start",
            DetailEvent::Block { .. } => "block",
            DetailEvent::Acceptance { .. } => "acceptance",
            DetailEvent::HistoryItem { .. } => "history-item",
            DetailEvent::SectionEnd { .. } => "section-end",
            DetailEvent::Complete { .. } => "complete",
        })
        .collect()
}

fn joined_blocks(events: &[DetailEvent]) -> String {
    events
        .iter()
        .filter_map(|e| match e {
            DetailEvent::Block { text, .. } => Some(text.as_str()),
            _ => None,
        })
        .collect()
}

#[test]
fn a_task_streams_start_document_history_complete_in_order() {
    let world = World::new();
    let id = world.task("Intro paragraph.\n\n## Heading\n\nMore text.\n");
    let snapshot = world.snapshot();
    let detail = DetailSnapshot::task(world.shared(), &snapshot, id, &BOTH).unwrap();
    let events = detail.events();
    validate(&events);
    let kinds = types(&events);
    assert_eq!(kinds.first(), Some(&"start"));
    assert_eq!(kinds.last(), Some(&"complete"));
    let first_block = kinds.iter().position(|k| *k == "block").unwrap();
    let first_history = kinds.iter().position(|k| *k == "history-item").unwrap();
    assert!(first_block < first_history);
    match &events[0] {
        DetailEvent::Start {
            resource,
            id: start_id,
            project_id,
            sections,
            ..
        } => {
            assert_eq!(*resource, DetailResource::Task);
            assert_eq!(*start_id, ResourceId::Task(id));
            assert_eq!(project_id, world.project.as_str());
            assert_eq!(sections, &BOTH.to_vec());
        }
        other => panic!("{other:?}"),
    }
    let task = snapshot.tasks.iter().find(|t| t.id == id).unwrap();
    assert_eq!(joined_blocks(&events), task.body);
    let acceptance = events
        .iter()
        .filter(|e| matches!(e, DetailEvent::Acceptance { .. }))
        .count();
    assert_eq!(acceptance, task.acceptance.len());
    let history = events
        .iter()
        .filter(|e| matches!(e, DetailEvent::HistoryItem { .. }))
        .count();
    assert_eq!(history, task.history.len());
    assert!(history > 0);
}

#[test]
fn a_single_section_leaves_the_other_out() {
    let world = World::new();
    let id = world.task("Text.\n");
    let snapshot = world.snapshot();
    let only = |section: Section| {
        let detail = DetailSnapshot::task(world.shared(), &snapshot, id, &[section]).unwrap();
        let events = detail.events();
        validate(&events);
        events
    };
    let history = only(Section::History);
    assert_eq!(types(&history).iter().filter(|k| **k == "block").count(), 0);
    assert!(!types(&history).contains(&"acceptance"));
    assert_eq!(types(&history)[1], "section-start");
    let document = only(Section::Document);
    assert!(!types(&document).contains(&"history-item"));
    assert!(types(&document).contains(&"block"));
    let DetailEvent::Start { versions, .. } = &document[0] else {
        panic!()
    };
    assert!(versions.document.is_some() && versions.history.is_none());
    let DetailEvent::Start { versions, .. } = &history[0] else {
        panic!()
    };
    assert!(versions.document.is_none() && versions.history.is_some());
}

#[test]
fn an_epic_streams_its_document_only() {
    let world = World::new();
    let id = world.epic("ALPHA", "# Alpha\n\nThe epic text.\n");
    let snapshot = world.snapshot();
    let detail =
        DetailSnapshot::epic(world.shared(), &snapshot, &id, &[Section::Document]).unwrap();
    let events = detail.events();
    validate(&events);
    assert_eq!(
        types(&events),
        ["start", "section-start", "block", "section-end", "complete"]
    );
    let epic = snapshot.epics.iter().find(|e| e.id == id).unwrap();
    assert_eq!(joined_blocks(&events), epic.body);
    let DetailEvent::Start {
        resource, id: rid, ..
    } = &events[0]
    else {
        panic!()
    };
    assert_eq!(*resource, DetailResource::Epic);
    assert_eq!(*rid, ResourceId::Epic("ALPHA".into()));
}

#[test]
fn start_and_complete_carry_the_versions_the_summary_computes() {
    let world = World::new();
    let id = world.task("Text.\n");
    let snapshot = world.snapshot();
    let task = snapshot.tasks.iter().find(|t| t.id == id).unwrap();
    let expected = task_versions(task);
    assert!(!expected.document.is_empty() && !expected.history.is_empty());
    let events = DetailSnapshot::task(world.shared(), &snapshot, id, &BOTH)
        .unwrap()
        .events();
    let (DetailEvent::Start { versions: a, .. }, DetailEvent::Complete { versions: b }) =
        (&events[0], events.last().unwrap())
    else {
        panic!()
    };
    assert_eq!(a, b);
    assert_eq!(a.document.as_deref(), Some(expected.document.as_str()));
    assert_eq!(a.history.as_deref(), Some(expected.history.as_str()));

    let epic = world.epic("BETA", "Document.\n");
    let snapshot = world.snapshot();
    let view = snapshot.epics.iter().find(|e| e.id == epic).unwrap();
    let events = DetailSnapshot::epic(world.shared(), &snapshot, &epic, &[Section::Document])
        .unwrap()
        .events();
    let DetailEvent::Start { versions, .. } = &events[0] else {
        panic!()
    };
    assert_eq!(
        versions.document.as_deref(),
        Some(epic_version(view).as_str())
    );
}

#[test]
fn versions_follow_the_content_and_ignore_other_fields() {
    let world = World::new();
    let id = world.task("Text.\n");
    let before = world.snapshot();
    let v1 = task_versions(before.tasks.iter().find(|t| t.id == id).unwrap());
    // A title change touches neither section.
    world
        .store
        .edit_task(&world.project, id, Some("Other title"), None, at(5))
        .unwrap();
    let v2 = task_versions(world.snapshot().tasks.iter().find(|t| t.id == id).unwrap());
    assert_eq!(v1.document, v2.document);
    // A body change moves the document version and, through its history entry, the history one.
    world
        .store
        .edit_task_parts(
            &world.project,
            id,
            None,
            TaskTextParts {
                body: Some("Changed.\n"),
                acceptance: None,
            },
            at(6),
        )
        .unwrap();
    let v3 = task_versions(world.snapshot().tasks.iter().find(|t| t.id == id).unwrap());
    assert_ne!(v2.document, v3.document);
}

#[test]
fn the_events_are_a_copy_that_later_changes_do_not_reach() {
    let world = World::new();
    let id = world.task("Original text.\n");
    let snapshot = world.snapshot();
    let detail = DetailSnapshot::task(world.shared(), &snapshot, id, &BOTH).unwrap();
    let before = detail.events();
    world
        .store
        .edit_task_parts(
            &world.project,
            id,
            None,
            TaskTextParts {
                body: Some("Replaced text.\n"),
                acceptance: None,
            },
            at(7),
        )
        .unwrap();
    // The files are changed; the copy still says what it said.
    assert_eq!(detail.events(), before);
    assert!(joined_blocks(&before).contains("Original"));
    let now = DetailSnapshot::task(world.shared(), &world.snapshot(), id, &BOTH).unwrap();
    assert!(joined_blocks(&now.events()).contains("Replaced"));
    assert_ne!(now.versions(), detail.versions());
}

#[test]
fn a_missing_task_or_epic_is_not_found() {
    let world = World::new();
    let snapshot = world.snapshot();
    assert!(matches!(
        DetailSnapshot::task(world.shared(), &snapshot, 99, &BOTH),
        Err(AgboardError::TaskNotFound { id: 99 })
    ));
    let missing: EpicId = "NOPE".parse().unwrap();
    assert!(matches!(
        DetailSnapshot::epic(world.shared(), &snapshot, &missing, &[Section::Document]),
        Err(AgboardError::EpicNotFound { .. })
    ));
}

#[test]
fn a_block_lists_the_images_it_refers_to_with_their_size() {
    let world = World::new();
    let id = world.task("Intro.\n");
    let owner = AttachmentOwner::Task(id);
    let a1 = "a".repeat(32);
    let a2 = "b".repeat(32);
    world.png(&owner, &a1, 40, 30);
    world.png(&owner, &a2, 7, 9);
    let url = |a: &str| format!("/api/projects/{}/tasks/{id}/attachments/{a}", world.project);
    let ghost = "c".repeat(32);
    let body = format!(
        "Intro.\n\n![one]({})\n\n![two]({}) and again ![one]({})\n\n![gone]({})\n",
        url(&a1),
        url(&a2),
        url(&a1),
        url(&ghost)
    );
    world
        .store
        .edit_task_parts(
            &world.project,
            id,
            None,
            TaskTextParts {
                body: Some(&body),
                acceptance: None,
            },
            at(8),
        )
        .unwrap();
    let snapshot = world.snapshot();
    let events = DetailSnapshot::task(world.shared(), &snapshot, id, &[Section::Document])
        .unwrap()
        .events();
    let images: Vec<_> = events
        .iter()
        .filter_map(|e| match e {
            DetailEvent::Block { images, .. } => Some(images.clone()),
            _ => None,
        })
        .flatten()
        .collect();
    let find = |a: &str| images.iter().find(|i| i.src == url(a)).unwrap();
    assert_eq!((find(&a1).width, find(&a1).height), (Some(40), Some(30)));
    assert_eq!((find(&a2).width, find(&a2).height), (Some(7), Some(9)));
    assert_eq!((find(&ghost).width, find(&ghost).height), (None, None));
    assert_eq!(images.iter().filter(|i| i.src == url(&a1)).count(), 1);
    assert!(events.iter().any(|e| matches!(
        e,
        DetailEvent::Block {
            kind: BlockKind::Markdown,
            ..
        }
    )));
}

#[test]
fn acceptance_conditions_follow_the_blocks_with_their_full_text() {
    use agent_board::file_store::frontmatter::AcceptanceItem;
    let world = World::new();
    let id = world.task("Body text.\n");
    let items = vec![
        AcceptanceItem {
            id: "AC-1".into(),
            text: "A long condition that is never cut short.".into(),
            done: true,
        },
        AcceptanceItem {
            id: "AC-2".into(),
            text: "Second.".into(),
            done: false,
        },
    ];
    world
        .store
        .edit_task_parts(
            &world.project,
            id,
            None,
            TaskTextParts {
                body: None,
                acceptance: Some(&items),
            },
            at(9),
        )
        .unwrap();
    let snapshot = world.snapshot();
    let events = DetailSnapshot::task(world.shared(), &snapshot, id, &[Section::Document])
        .unwrap()
        .events();
    validate(&events);
    let got: Vec<_> = events
        .iter()
        .filter_map(|e| match e {
            DetailEvent::Acceptance { id, text, done } => Some((id.clone(), text.clone(), *done)),
            _ => None,
        })
        .collect();
    assert_eq!(
        got,
        items
            .iter()
            .map(|i| (i.id.clone(), i.text.clone(), i.done))
            .collect::<Vec<_>>()
    );
    let kinds = types(&events);
    let last_block = kinds.iter().rposition(|k| *k == "block").unwrap();
    let first_acceptance = kinds.iter().position(|k| *k == "acceptance").unwrap();
    assert!(last_block < first_acceptance);
    let end = events.iter().find_map(|e| match e {
        DetailEvent::SectionEnd { count, .. } => Some(*count),
        _ => None,
    });
    assert_eq!(
        end,
        Some(
            u32::try_from(
                kinds
                    .iter()
                    .filter(|k| **k == "block" || **k == "acceptance")
                    .count()
            )
            .unwrap()
        )
    );
}
