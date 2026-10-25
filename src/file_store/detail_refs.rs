//! The attachment URLs a Markdown text mentions.

/// An attachment URL found in a text.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct AttachmentRef {
    /// The URL as written, from the first `/` of its path.
    pub src: String,
    /// The URL names a task (`true`) or an epic.
    pub tasks: bool,
    pub owner: String,
    pub attachment: String,
}

const MARK: &str = "/api/projects/";

/// Every `/api/projects/{project}/{tasks|epics}/{owner}/attachments/{id}` of `project_id` in
/// `text`, with or without the monitor's `/monitor` prefix.
pub(super) fn attachment_refs(text: &str, project_id: &str) -> Vec<AttachmentRef> {
    let mut found = Vec::new();
    let mut from = 0;
    while let Some(at) = text[from..].find(MARK) {
        let mark = from + at;
        let rest = &text[mark + MARK.len()..];
        from = mark + MARK.len();
        let mut parts = rest.splitn(5, '/');
        let (Some(project), Some(kind), Some(owner), Some(word), Some(tail)) = (
            parts.next(),
            parts.next(),
            parts.next(),
            parts.next(),
            parts.next(),
        ) else {
            continue;
        };
        let id_len = tail
            .find(|c: char| !c.is_ascii_alphanumeric())
            .unwrap_or(tail.len());
        if project != project_id
            || word != "attachments"
            || id_len == 0
            || !matches!(kind, "tasks" | "epics")
            || owner.is_empty()
        {
            continue;
        }
        let start = if text[..mark].ends_with("/monitor") {
            mark - "/monitor".len()
        } else {
            mark
        };
        let end = text.len() - tail.len() + id_len;
        found.push(AttachmentRef {
            src: text[start..end].to_string(),
            tasks: kind == "tasks",
            owner: owner.to_string(),
            attachment: tail[..id_len].to_string(),
        });
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROJECT: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn attachment_urls_are_found_with_or_without_the_monitor_prefix() {
        let text = format!(
            "![a](/api/projects/{PROJECT}/tasks/7/attachments/{a}) and \
             ![b](/monitor/api/projects/{PROJECT}/epics/ALPHA/attachments/{b}) \
             ![c](/api/projects/other/tasks/7/attachments/{a}) ![d](/api/projects/{PROJECT}/tasks/7/files/{a})",
            a = "a".repeat(32),
            b = "b".repeat(32)
        );
        let refs = attachment_refs(&text, PROJECT);
        assert_eq!(refs.len(), 2, "{refs:?}");
        assert_eq!(
            refs[0].src,
            format!(
                "/api/projects/{PROJECT}/tasks/7/attachments/{}",
                "a".repeat(32)
            )
        );
        assert!(refs[0].tasks && refs[0].owner == "7");
        assert!(refs[1].src.starts_with("/monitor/api/projects/"));
        assert!(!refs[1].tasks && refs[1].owner == "ALPHA");
    }
}
