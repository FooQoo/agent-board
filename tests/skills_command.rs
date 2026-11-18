//! `agboard skills`: the Agent Board Skill and its topics, printed by the
//! binary. It reads nothing, writes nothing, and always exits 0.

use std::process::Command;

/// Runs `agboard skills <args>` with an empty environment and a folder of its
/// own as the only place it could write to; returns the exit code, stdout, and
/// whether the folder is still empty.
fn skills(args: &[&str]) -> (i32, String, bool) {
    let home = tempfile::tempdir().unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env_clear()
        .env("HOME", home.path())
        .env("AGBOARD_HOME", home.path().join("data"))
        .env("AGBOARD_AUTOSTART", "0")
        .env("AGBOARD_OPEN_BROWSER", "0")
        .current_dir(home.path())
        .arg("skills")
        .args(args)
        .stdin(std::process::Stdio::null())
        .output()
        .unwrap();
    assert_eq!(output.stderr, b"");
    let untouched = std::fs::read_dir(home.path()).unwrap().next().is_none();
    (
        output.status.code().unwrap(),
        String::from_utf8(output.stdout).unwrap(),
        untouched,
    )
}

#[test]
fn skills_prints_the_skill_body_without_frontmatter_and_writes_nothing() {
    let (code, out, untouched) = skills(&[]);
    assert_eq!(code, 0);
    assert!(untouched, "agboard skills wrote a file");
    assert!(out.starts_with("# Agent Board\n"), "{}", &out[..80]);
    assert!(!out.starts_with("---"));
    assert!(out.contains("## 1. Resolve the project from the working folder"));
    // The references are topics, not files.
    for topic in [
        "file-format",
        "listening",
        "task-template",
        "epic-template",
        "bug-epic-template",
        "enhancement-epic-template",
    ] {
        assert!(
            out.contains(&format!("agboard skills {topic}")),
            "the body omits {topic}"
        );
    }
}

#[test]
fn every_topic_prints_its_text() {
    for (topic, heading) in [
        ("file-format", "# TASK.md and EPIC.md format"),
        ("listening", "# Listen for tasks in one session"),
        ("task-template", "# New task template"),
        ("epic-template", "# New epic template"),
        ("bug-epic-template", "# Fixed body of the BUG epic"),
        (
            "enhancement-epic-template",
            "# Fixed body of the ENHANCEMENT epic",
        ),
    ] {
        let (code, out, untouched) = skills(&[topic]);
        assert_eq!(code, 0, "{topic}");
        assert!(untouched);
        assert!(out.starts_with(heading), "{topic}: {out}");
    }
    let (_, template, _) = skills(&["task-template"]);
    assert!(template.contains("acceptance:"));
    let (_, bug, _) = skills(&["bug-epic-template"]);
    assert!(bug.contains("# Bug reports"));
}

#[test]
fn an_unknown_topic_exits_zero_and_lists_the_topics() {
    let (code, out, untouched) = skills(&["nope"]);
    assert_eq!(code, 0);
    assert!(untouched);
    assert!(out.starts_with("# No topic named `nope`"));
    for topic in ["file-format", "listening", "enhancement-epic-template"] {
        assert!(out.contains(&format!("`agboard skills {topic}`")), "{out}");
    }
    assert!(out.contains("upgrade agboard"));
}

#[test]
fn skills_works_without_a_data_directory() {
    let output = Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env_clear()
        .args(["skills"])
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(0));
    assert!(String::from_utf8_lossy(&output.stdout).starts_with("# Agent Board\n"));
}
