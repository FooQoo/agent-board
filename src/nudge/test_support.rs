//! Builders shared by the nudge tests.

use super::{Call, Facts, Turn};
use crate::domain::{Actor, Assignee, Column, NewTask, RunState};
use crate::file_store::FileStore;
use crate::progress::{self, FinalResultMissing, Include, Progress};

pub fn call(command: &str) -> Call {
    Call {
        name: "Bash".into(),
        command: command.into(),
        path: String::new(),
    }
}

pub fn write_call(path: &str) -> Call {
    Call {
        name: "Write".into(),
        command: String::new(),
        path: path.into(),
    }
}

/// A progress table with one AI task, running in Doing when `running`, and the
/// given ids listed as missing a final result.
pub fn progress_with(running: bool, missing: &[i64]) -> Progress {
    let home = tempfile::tempdir().unwrap();
    let store = FileStore::open(&home.path().join("shared"));
    let now = chrono::Utc::now();
    let project = store.create_project("Demo", now).unwrap().id;
    store
        .create_task(
            &project,
            NewTask {
                title: "T".into(),
                description: "## 作業内容\n\nx\n\n## 完了条件と確認結果\n\n- [ ] AC-1. Works\n  - 確認結果: 未確認\n  - 根拠: 未記入\n  - 調整役の確認: 未確認\n\n## 実行記録\n\n".into(),
                assignee: Assignee::Ai,
                actor: Actor::Human,
                draft: None,
            },
            now,
        )
        .unwrap();
    let snapshot = store.board(&project).unwrap();
    let mut table = progress::build_with(&snapshot, store.shared_dir(), now, Include::default());
    for task in table
        .epics
        .iter_mut()
        .flat_map(|e| e.tasks.iter_mut())
        .chain(table.unassigned.iter_mut())
    {
        task.draft = None;
        if running {
            task.task_status = Column::Doing;
            task.agent_status = RunState::Running;
        }
    }
    // The one task is not picked up next unless a case says so.
    table.next_tasks.clear();
    table.final_result_missing = missing
        .iter()
        .map(|id| FinalResultMissing {
            id: *id,
            title: "T".into(),
            task_path: "p".into(),
        })
        .collect();
    table
}

/// Everything a rule can see, owned, so a case can be written as a value.
#[derive(Default)]
pub struct Scenario {
    pub message: Option<&'static str>,
    pub turn: Option<Turn>,
    pub progress: Option<Progress>,
}

impl Scenario {
    /// A turn that made `calls`, ended with `message`, over `progress`.
    pub fn turn(message: &'static str, calls: Vec<Call>, progress: Option<Progress>) -> Scenario {
        Scenario {
            message: Some(message),
            turn: Some(Turn {
                last_text: None,
                calls,
            }),
            progress,
        }
    }

    /// Only a progress table: what a `State` rule sees.
    pub fn state(progress: Progress) -> Scenario {
        Scenario {
            progress: Some(progress),
            ..Scenario::default()
        }
    }

    pub fn facts(&self) -> Facts<'_> {
        Facts {
            progress: self.progress.as_ref(),
            turn: self.turn.as_ref(),
            message: self.message,
            now: chrono::Utc::now(),
        }
    }
}
