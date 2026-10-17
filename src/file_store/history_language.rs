//! Language of generated history. Explicit browser settings override text inference.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HistoryLanguage {
    English,
    Japanese,
}

impl HistoryLanguage {
    pub fn from_setting(value: &str) -> Option<Self> {
        match value {
            "en" => Some(Self::English),
            "ja" => Some(Self::Japanese),
            _ => None,
        }
    }

    pub(crate) fn infer(markdown: &str, title: &str) -> Self {
        // Exclude frontmatter: existing history must never select the next entry's language.
        let body = super::frontmatter::parse(markdown).body;
        let template = super::frontmatter::parse(&super::validate::task_template()).body;
        let prose = if body.trim().is_empty() || body.trim() == template.trim() {
            title
        } else {
            &body
        };
        if prose
            .chars()
            .any(|c| matches!(c, '\u{3040}'..='\u{30ff}' | '\u{3400}'..='\u{9fff}'))
        {
            Self::Japanese
        } else {
            Self::English
        }
    }

    pub(crate) fn text<'a>(self, english: &'a str, japanese: &'a str) -> &'a str {
        match self {
            Self::English => english,
            Self::Japanese => japanese,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::HistoryLanguage::{self, English, Japanese};

    #[test]
    fn inference_ignores_history_and_uses_title_only_for_empty_or_template_body() {
        assert_eq!(
            HistoryLanguage::infer(
                "---\nhistory:\n - at: 2026-10-17T00:00:00Z\n   reason: 日本語の古い履歴\n---\nEnglish body.",
                "日本語タイトル"
            ),
            English
        );
        assert_eq!(
            HistoryLanguage::infer("日本語の本文", "English title"),
            Japanese
        );
        assert_eq!(HistoryLanguage::infer("", "日本語タイトル"), Japanese);
        assert_eq!(
            HistoryLanguage::infer(
                &crate::file_store::validate::task_template(),
                "日本語タイトル"
            ),
            Japanese
        );
    }
}
