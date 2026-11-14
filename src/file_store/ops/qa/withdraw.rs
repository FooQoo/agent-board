//! Withdrawing a request. Answers already given stay; the open questions stop waiting.

use chrono::{DateTime, Utc};

use super::super::{lock_project, stamp};
use super::{referrers, request_change};
use crate::domain::{Actor, ProjectId};
use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::file_store::model::HistoryRecord;
use crate::file_store::qa::{
    MAX_WITHDRAW_REASON_CHARS, QaRequestFile, RequestStatus, read_request,
};
use crate::file_store::transaction::save_batch_locked;

fn normalize_reason(reason: Option<&str>) -> Result<Option<String>, AgboardError> {
    let Some(reason) = reason else {
        return Ok(None);
    };
    let text = reason.replace("\r\n", "\n").trim().to_owned();
    if text.is_empty() {
        return Ok(None);
    }
    if text.chars().count() > MAX_WITHDRAW_REASON_CHARS {
        return Err(AgboardError::InvalidValue {
            field: "reason".into(),
            reason: "A withdraw reason has 2,000 characters or fewer.".into(),
        });
    }
    Ok(Some(text))
}

impl FileStore {
    /// Withdraw a request. Withdrawing it again changes nothing. A request whose questions
    /// all have answers cannot be withdrawn.
    pub fn withdraw_request(
        &self,
        project: &ProjectId,
        request_id: &str,
        _actor: Actor,
        reason: Option<&str>,
        now: DateTime<Utc>,
    ) -> Result<QaRequestFile, AgboardError> {
        let reason = normalize_reason(reason)?;
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut request = read_request(shared, &project_dir, request_id)?;
        match request.status() {
            RequestStatus::Withdrawn => return Ok(request),
            RequestStatus::Answered => {
                return Err(AgboardError::RequestAnswered {
                    id: request_id.to_owned(),
                });
            }
            RequestStatus::Open => {}
        }
        let at = stamp(now);
        request.withdrawn_at = Some(at);
        request.withdraw_reason = reason.clone();
        let mut changes = vec![request_change(&project_dir, &request, false)?];

        let open: Vec<String> = request
            .questions
            .iter()
            .filter(|q| q.answer.is_none())
            .map(|q| q.id.clone())
            .collect();
        for mut referrer in referrers(shared, project, &project_dir, &open)? {
            if referrer.task.archived_at.is_some() {
                continue;
            }
            let language = self.history_language(project, &referrer.task)?;
            for id in open.iter().filter(|id| referrer.questions.contains(id)) {
                let suffix = reason
                    .as_ref()
                    .map(|r| format!("\n\n{r}"))
                    .unwrap_or_default();
                let english = format!("Withdrew a question ({id}).{suffix}");
                let japanese = format!("質問を取り下げました（{id}）。{suffix}");
                referrer.task.history.push(HistoryRecord {
                    at,
                    reason: language.text(&english, &japanese).to_owned(),
                });
            }
            referrer.task.updated_at = at;
            changes.extend(super::super::save::task_pair_changes(
                shared,
                &project_dir,
                &referrer.task,
                Some(&referrer.text),
            )?);
        }
        save_batch_locked(&project_dir, changes)?;
        Ok(request)
    }
}
