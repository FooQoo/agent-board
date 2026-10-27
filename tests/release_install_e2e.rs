//! One connected path through the built binary, as a user would walk it:
//! create a project (auto bind), connect both agents with the Skill Global
//! and the Hook Project, check that the installed Skill is the repository's
//! bundle, run the installed Hook command for a bound and an unbound folder,
//! age the records and update, and show that a board that existed before is
//! byte-identical at the end. Every location is inside one temporary
//! directory; the real home and agent settings are never read or written.

#![cfg(unix)]

mod update_fixture;

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde_json::Value;
use update_fixture::{Fx, world};

/// A 1x1 PNG, so the legacy board has a real attachment.
const PNG: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0x64, 0x60, 0xf8, 0x5f,
    0x0f, 0x00, 0x02, 0x87, 0x01, 0x80, 0xeb, 0x47, 0xba, 0x92, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
    0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

const LEGACY_TASK: &str = "---\nhistory:\n- at: 2026-01-02T03:04:05Z\n  reason: Created task in Todo with agent idle.\n- at: 2026-01-02T03:05:06Z\n  reason: Worked on it.\nreviewer: alice\nlabels: [a, b]\n---\n\nBody with an image ![pic](assets/ATTACHMENT.png)\n";
const LEGACY_EPIC: &str = "---\npriority: [1]\nowner: bob\nunknown_metadata:\n  nested: true\n---\n\n# Shipping plan\n\nKept as written.\n";

fn skill_bundle() -> BTreeMap<PathBuf, Vec<u8>> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join(".agents/skills/agent-board");
    let files = world(&root);
    assert!(files.len() >= 7, "the repository bundle looks incomplete");
    files
        .into_iter()
        .map(|(path, bytes)| (path.strip_prefix(&root).unwrap().to_path_buf(), bytes))
        .collect()
}

fn installed(dir: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    world(dir)
        .into_iter()
        .map(|(path, bytes)| (path.strip_prefix(dir).unwrap().to_path_buf(), bytes))
        .collect()
}

/// The files of the legacy project, without the lock and transaction area.
fn legacy_board(fx: &Fx) -> BTreeMap<PathBuf, Vec<u8>> {
    let projects = fx.data().join("shared/projects");
    let mut found = Vec::new();
    for entry in fs::read_dir(&projects).unwrap() {
        let dir = entry.unwrap().path();
        let text = fs::read_to_string(dir.join("project.json")).unwrap();
        if serde_json::from_str::<Value>(&text).unwrap()["name"] == "Legacy" {
            found.push(dir);
        }
    }
    assert_eq!(found.len(), 1, "exactly one Legacy project");
    let dir = &found[0];
    world(dir)
        .into_iter()
        .filter(|(path, _)| !path.starts_with(dir.join(".internal")))
        .map(|(path, bytes)| (path.strip_prefix(&projects).unwrap().to_path_buf(), bytes))
        .collect()
}

/// A board that existed before agboard connect: frontmatter history, an
/// attachment, an epic document, and metadata the product does not know.
fn make_legacy_board(fx: &Fx) {
    let dir = fx.base().join("legacy");
    fs::create_dir_all(&dir).unwrap();
    let ok = |args: &[&str]| {
        let (code, out, err) = fx.agboard(args, &dir);
        assert_eq!(code, 0, "{args:?}: {out}{err}");
        out
    };
    ok(&["project", "create", "Legacy"]);
    ok(&[
        "--project",
        "Legacy",
        "epic",
        "add",
        "shipping",
        "--name",
        "Shipping",
        "--actor",
        "human",
    ]);
    ok(&[
        "--project",
        "Legacy",
        "add",
        "Old task",
        "--assignee",
        "ai",
        "--actor",
        "human",
        "--epic",
        "shipping",
    ]);
    let png = fx.base().join("pic.png");
    fs::write(&png, PNG).unwrap();
    let out = ok(&[
        "--project",
        "Legacy",
        "attachment",
        "add",
        "1",
        "--file",
        png.to_str().unwrap(),
        "--actor",
        "human",
    ]);
    let id = out.split_whitespace().nth(2).unwrap().to_string();
    let task = LEGACY_TASK.replace("ATTACHMENT", &id);
    let task_file = fx.base().join("legacy-task.md");
    fs::write(&task_file, &task).unwrap();
    ok(&[
        "--project",
        "Legacy",
        "edit",
        "1",
        "--desc-file",
        task_file.to_str().unwrap(),
    ]);
    let epic_file = fx.base().join("legacy-epic.md");
    fs::write(&epic_file, LEGACY_EPIC).unwrap();
    ok(&[
        "--project",
        "Legacy",
        "epic",
        "edit",
        "SHIPPING",
        "--document-file",
        epic_file.to_str().unwrap(),
    ]);
}

/// Every `command` string below `value` that runs `agboard hook`.
fn hook_commands(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            for (key, inner) in map {
                match inner {
                    Value::String(text) if key == "command" && text.contains("agboard hook") => {
                        out.push(text.clone())
                    }
                    _ => hook_commands(inner, out),
                }
            }
        }
        Value::Array(items) => items.iter().for_each(|i| hook_commands(i, out)),
        _ => {}
    }
}

fn written_hook_commands(path: &Path) -> Vec<String> {
    let value: Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    let mut commands = Vec::new();
    hook_commands(&value, &mut commands);
    assert!(
        !commands.is_empty(),
        "{} holds no Hook command",
        path.display()
    );
    commands
}

/// Runs a written Hook command the way the agent does: through a shell, in
/// `cwd`, with a SessionStart event on standard input.
fn run_hook(fx: &Fx, command: &str, cwd: &Path) -> (i32, String, String) {
    let mut shell = std::process::Command::new("/bin/sh");
    shell
        .arg("-c")
        .arg(command)
        .current_dir(cwd)
        .env_clear()
        .envs(
            fx.command(cwd)
                .get_envs()
                .filter_map(|(k, v)| v.map(|v| (k, v))),
        )
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = shell.spawn().unwrap();
    let event = format!(
        "{{\"hook_event_name\":\"SessionStart\",\"cwd\":{:?}}}",
        cwd.to_str().unwrap()
    );
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(event.as_bytes())
        .unwrap();
    drop(child.stdin.take());
    let output = child.wait_with_output().unwrap();
    (
        output.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&output.stdout).into_owned(),
        String::from_utf8_lossy(&output.stderr).into_owned(),
    )
}

#[test]
fn install_connect_hook_and_update_keep_an_existing_board_untouched() {
    let fx = Fx::unbound();
    // The command written into the Hook config is `agboard hook ...`, found on PATH.
    std::os::unix::fs::symlink(
        assert_cmd::cargo::cargo_bin("agboard"),
        fx.base().join("bin/agboard"),
    )
    .unwrap();

    // A board from before, with a user's own settings and Skill beside it.
    make_legacy_board(&fx);
    let legacy_before = legacy_board(&fx);
    fs::create_dir_all(fx.root().join(".claude/skills/mine")).unwrap();
    fs::write(fx.root().join(".claude/skills/mine/SKILL.md"), "my skill\n").unwrap();
    fs::write(
        fx.root().join(".claude/settings.json"),
        "{\n  \"theme\": \"dark\"\n}\n",
    )
    .unwrap();

    // Create a project: the run folder is bound, and a child folder resolves it.
    let (code, out, err) = fx.agboard(&["project", "create", "Demo"], &fx.root());
    assert_eq!(code, 0, "{out}{err}");
    let child = fx.root().join("src/deep");
    fs::create_dir_all(&child).unwrap();
    let (code, out, err) = fx.agboard(&["progress", "--json"], &child);
    assert_eq!(code, 0, "{out}{err}");
    assert_eq!(
        serde_json::from_str::<Value>(&out).unwrap()["project"]["name"],
        "Demo"
    );
    let (code, _, err) = fx.agboard(
        &[
            "--project",
            "Demo",
            "add",
            "Demo task",
            "--assignee",
            "ai",
            "--actor",
            "human",
        ],
        &fx.root(),
    );
    assert_eq!(code, 0, "{err}");

    // Connect both agents: Skill Global, Hook Project.
    fx.connect_both("1", "2");

    // The installed Skill is the repository's bundle, byte for byte.
    let bundle = skill_bundle();
    assert_eq!(
        installed(&fx.skill_dir(update_fixture_agent(true), false)),
        bundle
    );
    assert_eq!(
        installed(&fx.skill_dir(update_fixture_agent(false), false)),
        bundle
    );

    // The Hook for the bound folder reports this project only.
    let claude_hooks = written_hook_commands(&fx.root().join(".claude/settings.json"));
    let codex_hooks = written_hook_commands(&fx.root().join(".codex/hooks.json"));
    for command in claude_hooks.iter().chain(codex_hooks.iter()) {
        let (code, stdout, stderr) = run_hook(&fx, command, &fx.root());
        assert_eq!(code, 0, "{command}: {stderr}");
        assert!(stdout.contains("AGBOARD_PROGRESS"), "{command}: {stdout:?}");
        assert!(stdout.contains("Demo task"), "{stdout}");
        assert!(
            !stdout.contains("Old task") && !stdout.contains("Legacy"),
            "{stdout}"
        );
        assert!(stderr.is_empty(), "{stderr}");
        // An unbound folder gets nothing, and the Hook still succeeds.
        let (code, stdout, stderr) = run_hook(&fx, command, &fx.other());
        assert_eq!(
            (code, stdout.as_str(), stderr.as_str()),
            (0, "", ""),
            "{command}"
        );
    }

    // Update with --yes after the records age: records are current again, and
    // the user's own settings and Skill are kept.
    fx.age("0.0.1", |_| true);
    assert_ne!(
        installed(&fx.skill_dir(update_fixture_agent(true), false)),
        bundle
    );
    let (code, stdout, stderr) = fx.agboard(&["update", "--yes"], &fx.root());
    assert_eq!(code, 0, "{stdout}{stderr}");
    assert!(stdout.contains("Claude Code: updated."), "{stdout}");
    assert!(stdout.contains("Codex: updated."), "{stdout}");
    assert_eq!(
        installed(&fx.skill_dir(update_fixture_agent(true), false)),
        bundle
    );
    assert_eq!(
        installed(&fx.skill_dir(update_fixture_agent(false), false)),
        bundle
    );
    for record in &fx.read_registry().installations {
        assert_eq!(record.installed_version, env!("CARGO_PKG_VERSION"));
    }
    let settings: Value =
        serde_json::from_str(&fs::read_to_string(fx.root().join(".claude/settings.json")).unwrap())
            .unwrap();
    assert_eq!(settings["theme"], "dark");
    assert_eq!(
        fs::read_to_string(fx.root().join(".claude/skills/mine/SKILL.md")).unwrap(),
        "my skill\n"
    );
    let commands = written_hook_commands(&fx.root().join(".claude/settings.json"));
    assert_eq!(
        commands, claude_hooks,
        "update must not duplicate or change the Hook"
    );
    // A second update has nothing to do.
    let (code, stdout, stderr) = fx.agboard(&["update", "--yes"], &fx.root());
    assert_eq!(code, 0, "{stdout}{stderr}");

    // The board that existed before is byte-identical, and still bound.
    assert_eq!(legacy_board(&fx), legacy_before);
    let (code, out, err) = fx.agboard(&["progress", "--json"], &fx.base().join("legacy"));
    assert_eq!(code, 0, "{out}{err}");
    assert_eq!(
        serde_json::from_str::<Value>(&out).unwrap()["project"]["name"],
        "Legacy"
    );
}

fn update_fixture_agent(claude: bool) -> agent_board::integrations::Agent {
    if claude {
        agent_board::integrations::Agent::Claude
    } else {
        agent_board::integrations::Agent::Codex
    }
}

fn repo_text(path: &str) -> String {
    fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join(path)).unwrap()
}

/// The anchors of the heading lines that end with `{#anchor}` after `marker`.
fn preview_anchors(page: &str, marker: &str) -> Vec<String> {
    let section = page.split_once(marker).expect("preview section").1;
    let section = section.split("\n## ").next().unwrap();
    section
        .lines()
        .filter(|line| line.starts_with("### "))
        .filter_map(|line| line.rsplit_once("{#"))
        .map(|(_, rest)| rest.trim_end_matches('}').to_string())
        .collect()
}

/// The rows of the general availability table (without header and rule).
fn ga_rows(page: &str, marker: &str) -> Vec<String> {
    let section = page.split_once(marker).expect("GA section").1;
    let section = section.split("\n## ").next().unwrap();
    section
        .lines()
        .filter(|line| line.starts_with('|'))
        .skip(2)
        .map(str::to_string)
        .collect()
}

#[test]
fn the_documented_stages_match_the_confirmed_classification() {
    // The web source is the one list of preview features; the docs follow it.
    let source = repo_text("web/src/shared/ui/preview-feature/feature-stage.ts");
    let in_product: Vec<String> = source
        .lines()
        .filter_map(|line| line.split_once("anchor: '"))
        .map(|(_, rest)| rest.split('\'').next().unwrap().to_string())
        .collect();
    assert_eq!(
        in_product,
        [
            "docs",
            "mobile-monitor",
            "onboarding",
            "connect-and-update",
            "listen"
        ]
    );
    let mut expected = in_product.clone();
    expected.sort();

    for (path, preview, ga, notice) in [
        (
            "docs/guide/feature-stages.md",
            "\n## Features in public preview",
            "\n## Features in general availability",
            "This feature is in public preview. Its behavior and specifications may change. See the documentation for current limitations.",
        ),
        (
            "docs/ja/guide/feature-stages.md",
            "\n## パブリックプレビューの機能",
            "\n## 一般提供（GA）の機能",
            "この機能はパブリックプレビューです。仕様や動作が変更される可能性があります。現在の制約はドキュメントをご確認ください。",
        ),
    ] {
        let page = repo_text(path);
        let mut anchors = preview_anchors(&page, preview);
        anchors.sort();
        assert_eq!(anchors, expected, "{path}: the preview sections");
        // Ten GA features, and none of the preview ones among them.
        let rows = ga_rows(&page, ga);
        assert_eq!(rows.len(), 10, "{path}: {rows:#?}");
        for row in &rows {
            for name in [
                "Docs",
                "connect",
                "listen",
                "Mobile monitor",
                "モバイルモニター",
                "初回の案内",
            ] {
                let cell = row.split('|').nth(1).unwrap();
                assert!(!cell.contains(name), "{path}: {name} is listed as GA");
            }
        }
        assert!(page.contains(notice), "{path}: the adopted notice");
        // The terminal line is the same text the product prints.
        assert!(
            page.contains("Public preview: this command may change. See the documentation for current limitations."),
            "{path}: the CLI line"
        );
    }
}
