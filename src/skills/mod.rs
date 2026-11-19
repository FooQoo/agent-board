//! `agboard skills`: the text of the Agent Board Skill, served by the binary.
//!
//! The authoritative text is embedded at build time: `agent-board.md` is the
//! Skill body, and `topics/` holds the references and templates it points to
//! with `agboard skills <topic>`. The plugin's `SKILL.md` is only a thin entry
//! that runs `agboard skills`, so the instructions always match the binary
//! that runs them.
//!
//! Printing reads nothing and writes nothing, and every answer, an unknown
//! topic included, is Markdown printed with exit code 0.

/// The Skill body, as Markdown without frontmatter.
pub const AGENT_BOARD: &str = include_str!("agent-board.md");

/// The topics: name and text.
pub const TOPICS: &[(&str, &str)] = &[
    ("file-format", include_str!("topics/file-format.md")),
    ("listening", include_str!("topics/listening.md")),
    ("resident", include_str!("topics/resident.md")),
    ("planning", include_str!("topics/planning.md")),
    (
        "fixed-epic-bodies",
        include_str!("topics/fixed-epic-bodies.md"),
    ),
    ("drafts", include_str!("topics/drafts.md")),
    ("phone", include_str!("topics/phone.md")),
    ("results", include_str!("topics/results.md")),
    ("task-template", include_str!("topics/task-template.md")),
    ("epic-template", include_str!("topics/epic-template.md")),
    (
        "bug-epic-template",
        include_str!("topics/bug-epic-template.md"),
    ),
    (
        "enhancement-epic-template",
        include_str!("topics/enhancement-epic-template.md"),
    ),
];

/// What `agboard skills [TOPIC]` prints: the main text, a topic, or, for a
/// name that is no topic, the list of topics.
pub fn render(topic: Option<&str>) -> String {
    let Some(topic) = topic else {
        return AGENT_BOARD.to_string();
    };
    match TOPICS.iter().find(|(name, _)| *name == topic) {
        Some((_, text)) => (*text).to_string(),
        None => unknown(topic),
    }
}

fn unknown(topic: &str) -> String {
    let list: Vec<String> = TOPICS
        .iter()
        .map(|(name, _)| format!("- `agboard skills {name}`"))
        .collect();
    format!(
        "# No topic named `{topic}`\n\nThe topics of this agboard (version {}) are:\n\n{}\n\n`agboard skills` without a topic prints the main instructions. If a topic you were told to read is missing, this agboard may be older than the plugin that named it: ask the user to upgrade agboard.\n",
        env!("CARGO_PKG_VERSION"),
        list.join("\n"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_main_text_has_no_frontmatter_and_names_no_file_the_plugin_lacks() {
        assert!(AGENT_BOARD.starts_with("# Agent Board\n"));
        for stale in ["references/", "SKILL.md"] {
            assert!(!AGENT_BOARD.contains(stale), "the text mentions {stale}");
        }
        // `assets/<attachment-id>` is the image path of a task body.
        assert!(
            !AGENT_BOARD
                .replace("assets/<attachment-id>", "")
                .contains("assets/")
        );
    }

    #[test]
    fn every_topic_the_text_names_exists() {
        let all = std::iter::once(AGENT_BOARD).chain(TOPICS.iter().map(|(_, text)| *text));
        for text in all {
            for (at, _) in text.match_indices("agboard skills ") {
                let name: String = text[at + 15..]
                    .chars()
                    .take_while(|c| c.is_ascii_lowercase() || *c == '-')
                    .collect();
                if name.is_empty() {
                    continue;
                }
                assert!(
                    TOPICS.iter().any(|(topic, _)| *topic == name),
                    "the text names the topic {name}, which does not exist"
                );
            }
        }
    }

    /// Claude Code inlines the output of a `!` command only up to about
    /// 30,000 characters; a longer output is cut to a short preview and the
    /// rest goes to a file the model may never read. Keep a margin.
    const INLINE_LIMIT: usize = 28_000;

    #[test]
    fn every_text_stays_under_the_claude_code_injection_limit() {
        let all = std::iter::once(("the main text", AGENT_BOARD))
            .chain(TOPICS.iter().map(|(name, text)| (*name, *text)));
        for (name, text) in all {
            let chars = text.chars().count();
            assert!(
                chars <= INLINE_LIMIT,
                "{name} has {chars} characters. Claude Code inlines a `!` command's output only up to about 30,000 characters, so keep each text at {INLINE_LIMIT} or fewer: move situational sections into a topic."
            );
        }
    }

    #[test]
    fn every_topic_is_named_by_the_main_text_or_another_topic() {
        for (name, _) in TOPICS {
            let command = format!("agboard skills {name}");
            assert!(
                AGENT_BOARD.contains(&command)
                    || TOPICS.iter().any(|(_, text)| text.contains(&command)),
                "nothing points at the topic {name}"
            );
        }
    }
}
