//! The AI draft of earlier versions (`draft: "ai"`), read as the Backlog.
//!
//! Earlier versions marked a plan an agent made with `draft: "ai"` and left it
//! in Todo. The Backlog replaces that mark, so a stored `"ai"` is converted when
//! the file is read: in memory for a read-only command, and on disk by the
//! one-time migration (`ops::backlog_migrate`) that runs under the project lock.
//! Both use the functions here, so what a read shows is what the migration
//! writes. The history entry is the migration's alone.

use serde_json::{Value, json};

use super::layout::BACKLOG_FORMAT_VERSION;

fn is_legacy(value: &Value) -> bool {
    value.get("draft").and_then(Value::as_str) == Some("ai")
}

/// Whether a parsed `task.json` or `epic.json` still holds `draft: "ai"`.
pub(crate) fn is_legacy_ai_draft(value: &Value) -> bool {
    is_legacy(value)
}

/// Convert a `task.json` with `draft: "ai"`. Returns whether it changed.
///
/// - Todo or Doing, not archived: the Backlog.
/// - Done, or archived: only the draft goes. The lane and the archive stay.
pub(crate) fn upgrade_task_value(value: &mut Value) -> bool {
    if !is_legacy(value) {
        return false;
    }
    let archived = !value.get("archivedAt").is_none_or(Value::is_null);
    let lane = value
        .get("taskStatus")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let Some(object) = value.as_object_mut() else {
        return false;
    };
    object.insert("draft".into(), Value::Null);
    if !archived && matches!(lane.as_deref(), Some("todo") | Some("doing")) {
        object.insert("taskStatus".into(), json!("backlog"));
        // Only an idle task can wait in the Backlog.
        object.insert("agentStatus".into(), json!("idle"));
        object.insert("formatVersion".into(), json!(BACKLOG_FORMAT_VERSION));
    }
    true
}

/// Convert an `epic.json` with `draft: "ai"`: the epic has no draft.
pub(crate) fn upgrade_epic_value(value: &mut Value) -> bool {
    if !is_legacy(value) {
        return false;
    }
    let Some(object) = value.as_object_mut() else {
        return false;
    };
    object.insert("draft".into(), Value::Null);
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task(lane: &str, archived: bool, epic: Option<&str>) -> Value {
        json!({
            "formatVersion": 1, "taskStatus": lane, "agentStatus": "idle",
            "draft": "ai", "epicId": epic,
            "archivedAt": if archived { json!("2026-11-01T00:00:00Z") } else { Value::Null },
        })
    }

    #[test]
    fn todo_and_doing_move_to_the_backlog() {
        for lane in ["todo", "doing"] {
            let mut v = task(lane, false, None);
            assert!(upgrade_task_value(&mut v));
            assert_eq!(v["taskStatus"], "backlog");
            assert_eq!(v["draft"], Value::Null);
            assert_eq!(v["formatVersion"], 2);
            assert!(v.get("delegation").is_none());
        }
        let mut in_epic = task("todo", false, Some("E"));
        assert!(upgrade_task_value(&mut in_epic));
        assert_eq!(in_epic["taskStatus"], "backlog");
    }

    #[test]
    fn done_and_archived_only_lose_the_draft() {
        let mut done = task("done", false, None);
        assert!(upgrade_task_value(&mut done));
        assert_eq!(done["taskStatus"], "done");
        assert_eq!(done["draft"], Value::Null);
        let mut archived = task("todo", true, None);
        assert!(upgrade_task_value(&mut archived));
        assert_eq!(archived["taskStatus"], "todo");
        assert_eq!(archived["draft"], Value::Null);
    }

    #[test]
    fn other_files_are_not_changed_and_a_second_run_changes_nothing() {
        let mut human = json!({"formatVersion": 1, "draft": "human"});
        assert!(!upgrade_task_value(&mut human));
        let mut v = task("todo", false, None);
        assert!(upgrade_task_value(&mut v));
        let once = v.clone();
        assert!(!upgrade_task_value(&mut v));
        assert_eq!(v, once);
        let mut epic = json!({"formatVersion": 1, "draft": "ai"});
        assert!(upgrade_epic_value(&mut epic));
        assert_eq!(epic["draft"], Value::Null);
        assert!(!upgrade_epic_value(&mut epic));
    }
}
