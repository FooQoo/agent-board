//! Focused tests for the embedded bundle, its hashes, and the installation
//! registry schema. Every file is read from the repository sources or from a
//! temporary directory; no real agent configuration is touched.

use std::path::{Path, PathBuf};

use agent_board::integrations::assets::{
    bundle, canonical_json, hook_managed_entries, hook_manifest_hash, sha256_hex,
    skill_manifest_hash,
};
use agent_board::integrations::registry::{
    InstallationRecord, ManagedFile, ManagedHookEntry, Registry,
};
use agent_board::integrations::{Agent, Component, IntegrationError, Scope};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const MANIFEST_DIR: &str = env!("CARGO_MANIFEST_DIR");

/// The bundle paths and the repository sources they were embedded from.
fn expected_sources() -> Vec<(&'static str, &'static str)> {
    vec![
        (
            "hooks/claude.json",
            "integrations/claude-code/settings.json",
        ),
        ("hooks/codex.json", "integrations/codex/hooks.json"),
        ("skill/SKILL.md", ".agents/skills/agent-board/SKILL.md"),
        (
            "skill/assets/BUG-EPIC.md",
            ".agents/skills/agent-board/assets/BUG-EPIC.md",
        ),
        (
            "skill/assets/ENHANCEMENT-EPIC.md",
            ".agents/skills/agent-board/assets/ENHANCEMENT-EPIC.md",
        ),
        (
            "skill/assets/EPIC.md",
            ".agents/skills/agent-board/assets/EPIC.md",
        ),
        (
            "skill/assets/TASK.md",
            ".agents/skills/agent-board/assets/TASK.md",
        ),
        (
            "skill/references/file-format.md",
            ".agents/skills/agent-board/references/file-format.md",
        ),
        (
            "skill/references/listening.md",
            ".agents/skills/agent-board/references/listening.md",
        ),
    ]
}

fn source(relative: &str) -> PathBuf {
    Path::new(MANIFEST_DIR).join(relative)
}

fn is_sha256_hex(text: &str) -> bool {
    text.len() == 64
        && text
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn fixed_hash() -> String {
    "a".repeat(64)
}

#[test]
fn bundle_contains_exactly_the_allowlisted_files() {
    let bundle = bundle().unwrap();
    let mut names: Vec<&str> = bundle.entries.iter().map(|e| e.relative_path).collect();
    let mut expected: Vec<&str> = expected_sources().iter().map(|(name, _)| *name).collect();
    names.sort_unstable();
    expected.sort_unstable();
    assert_eq!(names, expected);
}

#[test]
fn bundle_bytes_and_hashes_match_the_repository_sources() {
    let bundle = bundle().unwrap();
    for (name, relative) in expected_sources() {
        let entry = bundle
            .entry(name)
            .unwrap_or_else(|| panic!("{name} is embedded"));
        let on_disk = std::fs::read(source(relative)).unwrap();
        assert_eq!(entry.bytes, on_disk.as_slice(), "bytes of {name}");
        let digest = format!("{:x}", Sha256::digest(&on_disk));
        assert_eq!(entry.sha256, digest, "sha256 of {name}");
        assert_eq!(sha256_hex(entry.bytes), digest);
    }
}

#[test]
fn bundle_records_the_package_version_and_no_development_paths() {
    let bundle = bundle().unwrap();
    assert_eq!(bundle.version, env!("CARGO_PKG_VERSION"));
    for entry in &bundle.entries {
        let text = String::from_utf8_lossy(entry.bytes);
        assert!(
            !text.contains(MANIFEST_DIR),
            "{} embeds the development path",
            entry.relative_path
        );
        assert!(
            !text.contains("/Users/"),
            "{} embeds a home path",
            entry.relative_path
        );
    }
}

#[test]
fn skill_files_keep_their_bundle_paths_in_sorted_order() {
    let bundle = bundle().unwrap();
    let paths: Vec<&str> = bundle
        .skill_files()
        .iter()
        .map(|e| e.relative_path)
        .collect();
    assert_eq!(
        paths,
        [
            "skill/SKILL.md",
            "skill/assets/BUG-EPIC.md",
            "skill/assets/ENHANCEMENT-EPIC.md",
            "skill/assets/EPIC.md",
            "skill/assets/TASK.md",
            "skill/references/file-format.md",
            "skill/references/listening.md",
        ]
    );
    let managed: Vec<String> = bundle
        .skill_managed_files()
        .into_iter()
        .map(|f| f.path)
        .collect();
    assert_eq!(
        managed,
        [
            "SKILL.md",
            "assets/BUG-EPIC.md",
            "assets/ENHANCEMENT-EPIC.md",
            "assets/EPIC.md",
            "assets/TASK.md",
            "references/file-format.md",
            "references/listening.md",
        ]
    );
}

#[test]
fn every_reference_in_the_skill_is_embedded() {
    let bundle = bundle().unwrap();
    let skill = std::str::from_utf8(bundle.entry("skill/SKILL.md").unwrap().bytes).unwrap();
    for folder in ["references/", "assets/"] {
        for (at, _) in skill.match_indices(folder) {
            let name: String = skill[at..]
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '.' | '-' | '_'))
                .collect();
            assert!(
                bundle.entry(&format!("skill/{name}")).is_some(),
                "SKILL.md refers to {name}, which is not embedded"
            );
        }
    }
}

#[test]
fn skill_manifest_hash_is_sorted_and_content_sensitive() {
    let bundle = bundle().unwrap();
    let files = bundle.skill_managed_files();
    let mut shuffled = files.clone();
    shuffled.reverse();
    let hash = skill_manifest_hash(&files);
    assert_eq!(hash, skill_manifest_hash(&shuffled));

    let mut expected = Sha256::new();
    let mut sorted = files.clone();
    sorted.sort_by(|a, b| a.path.cmp(&b.path));
    for file in &sorted {
        expected.update(format!("{}\t{}\n", file.path, file.sha256).as_bytes());
    }
    assert_eq!(hash, format!("{:x}", expected.finalize()));
    assert!(is_sha256_hex(&hash));

    let mut changed = files;
    changed[0].sha256 = fixed_hash();
    assert_ne!(hash, skill_manifest_hash(&changed));
}

#[test]
fn claude_hook_template_yields_its_three_managed_groups() {
    let bundle = bundle().unwrap();
    let entries = hook_managed_entries(&bundle, Agent::Claude).unwrap();
    let events: Vec<&str> = entries.iter().map(|e| e.event.as_str()).collect();
    assert_eq!(
        events,
        ["PostToolUse", "PostToolUseFailure", "SessionStart"]
    );
    let session = entries.iter().find(|e| e.event == "SessionStart").unwrap();
    assert_eq!(
        session.matcher.as_deref(),
        Some("startup|resume|clear|compact")
    );
    for entry in &entries {
        assert_eq!(entry.command, "agboard hook --agent claude");
        assert!(is_sha256_hex(&entry.sha256));
    }
    let post = entries.iter().find(|e| e.event == "PostToolUse").unwrap();
    assert_eq!(post.matcher, None);
}

#[test]
fn codex_hook_template_yields_its_two_managed_groups() {
    let bundle = bundle().unwrap();
    let entries = hook_managed_entries(&bundle, Agent::Codex).unwrap();
    let events: Vec<&str> = entries.iter().map(|e| e.event.as_str()).collect();
    assert_eq!(events, ["PostToolUse", "SessionStart"]);
    for entry in &entries {
        assert_eq!(entry.command, "agboard hook --agent codex");
    }
    let session = entries.iter().find(|e| e.event == "SessionStart").unwrap();
    assert_eq!(
        session.matcher.as_deref(),
        Some("startup|resume|clear|compact")
    );
}

#[test]
fn managed_group_hash_is_the_sha256_of_its_canonical_json() {
    let bundle = bundle().unwrap();
    let template: Value =
        serde_json::from_slice(bundle.entry("hooks/claude.json").unwrap().bytes).unwrap();
    let group = &template["hooks"]["SessionStart"][0];
    let expected = sha256_hex(canonical_json(group).as_bytes());
    let entries = hook_managed_entries(&bundle, Agent::Claude).unwrap();
    let session = entries.iter().find(|e| e.event == "SessionStart").unwrap();
    assert_eq!(session.sha256, expected);
}

#[test]
fn canonical_json_sorts_keys_at_every_depth() {
    let value = json!({"b": [{"y": 1, "x": 2}], "a": "t"});
    assert_eq!(canonical_json(&value), r#"{"a":"t","b":[{"x":2,"y":1}]}"#);
}

#[test]
fn hook_manifest_hash_changes_with_the_command() {
    let bundle = bundle().unwrap();
    let entries = hook_managed_entries(&bundle, Agent::Codex).unwrap();
    let hash = hook_manifest_hash(&entries);
    assert!(is_sha256_hex(&hash));
    assert_eq!(hash, hook_manifest_hash(&entries));
    let mut changed: Vec<ManagedHookEntry> = entries;
    changed[0].command = "agboard hook --agent codex --project x".into();
    assert_ne!(hash, hook_manifest_hash(&changed));
}

#[test]
fn sha256_hex_matches_the_known_vector_for_empty_input() {
    assert_eq!(
        sha256_hex(b""),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
}

fn sample_registry() -> Registry {
    let skill = InstallationRecord {
        agent: Agent::Claude,
        component: Component::Skill,
        scope: Scope::Global,
        project_id: None,
        bound_root: None,
        configured_path: PathBuf::from("/fixture/home/.claude/skills/agent-board"),
        resolved_path: PathBuf::from("/fixture/home/.claude/skills/agent-board"),
        installed_version: "0.1.0".into(),
        managed_hash: fixed_hash(),
        managed_entries: Vec::new(),
        files: vec![ManagedFile {
            path: "SKILL.md".into(),
            sha256: fixed_hash(),
        }],
    };
    let hook = InstallationRecord {
        agent: Agent::Codex,
        component: Component::Hook,
        scope: Scope::Project,
        project_id: Some("project-1".into()),
        bound_root: Some(PathBuf::from("/fixture/My Projects/工場 board")),
        configured_path: PathBuf::from("/fixture/My Projects/工場 board/.codex/hooks.json"),
        resolved_path: PathBuf::from("/fixture/My Projects/工場 board/.codex/hooks.json"),
        installed_version: "0.1.0".into(),
        managed_hash: fixed_hash(),
        managed_entries: vec![ManagedHookEntry {
            event: "SessionStart".into(),
            matcher: Some("startup|resume|clear|compact".into()),
            command: "agboard hook --agent codex".into(),
            sha256: fixed_hash(),
        }],
        files: Vec::new(),
    };
    Registry {
        installations: vec![skill, hook],
    }
}

#[test]
fn registry_round_trips_and_uses_the_documented_keys() {
    let registry = sample_registry();
    let text = registry.to_json();
    assert_eq!(Registry::parse(&text).unwrap(), registry);

    let value: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(value["schemaVersion"], json!(1));
    let installations = value["installations"].as_array().unwrap();
    let global = &installations[0];
    assert_eq!(global["agent"], json!("claude"));
    assert_eq!(global["component"], json!("skill"));
    assert_eq!(global["scope"], json!("global"));
    assert!(
        global.get("projectId").is_none(),
        "global records carry no project"
    );
    assert!(global.get("boundRoot").is_none());
    assert_eq!(global["files"][0]["path"], json!("SKILL.md"));
    let project = &installations[1];
    assert_eq!(project["projectId"], json!("project-1"));
    assert_eq!(
        project["boundRoot"],
        json!("/fixture/My Projects/工場 board")
    );
    assert_eq!(project["managedEntries"][0]["event"], json!("SessionStart"));
    assert_eq!(
        project["managedEntries"][0]["matcher"],
        json!("startup|resume|clear|compact")
    );
}

#[test]
fn registry_refuses_other_schema_versions_without_migrating() {
    let mut value: Value = serde_json::from_str(&sample_registry().to_json()).unwrap();
    value["schemaVersion"] = json!(2);
    let text = value.to_string();
    assert_eq!(
        Registry::parse(&text),
        Err(IntegrationError::UnknownSchema(2))
    );
    value["schemaVersion"] = json!(0);
    assert_eq!(
        Registry::parse(&value.to_string()),
        Err(IntegrationError::UnknownSchema(0))
    );
    value.as_object_mut().unwrap().remove("schemaVersion");
    assert!(matches!(
        Registry::parse(&value.to_string()),
        Err(IntegrationError::Registry(_))
    ));
}

type Mutation = Box<dyn Fn(&mut Value)>;

#[test]
fn registry_refuses_broken_records() {
    let valid: Value = serde_json::from_str(&sample_registry().to_json()).unwrap();
    let cases: Vec<(&str, Mutation)> = vec![
        (
            "project without boundRoot",
            Box::new(|v| {
                v["installations"][1]
                    .as_object_mut()
                    .unwrap()
                    .remove("boundRoot");
            }),
        ),
        (
            "global with boundRoot",
            Box::new(|v| {
                v["installations"][0]["boundRoot"] = json!("/fixture/x");
            }),
        ),
        (
            "relative configuredPath",
            Box::new(|v| {
                v["installations"][0]["configuredPath"] = json!("relative/skills");
            }),
        ),
        (
            "skill with managedEntries",
            Box::new(|v| {
                v["installations"][0]["managedEntries"] = json!([{
                    "event": "SessionStart", "matcher": null,
                    "command": "agboard hook --agent claude", "sha256": "a".repeat(64)
                }]);
            }),
        ),
        (
            "hook with files",
            Box::new(|v| {
                v["installations"][1]["files"] =
                    json!([{"path": "SKILL.md", "sha256": "a".repeat(64)}]);
            }),
        ),
        (
            "duplicate installation",
            Box::new(|v| {
                let first = v["installations"][0].clone();
                v["installations"].as_array_mut().unwrap().push(first);
            }),
        ),
        (
            "uppercase managedHash",
            Box::new(|v| {
                v["installations"][0]["managedHash"] = json!("A".repeat(64));
            }),
        ),
        (
            "unknown agent",
            Box::new(|v| {
                v["installations"][0]["agent"] = json!("gemini");
            }),
        ),
        (
            "file path escaping the skill",
            Box::new(|v| {
                v["installations"][0]["files"][0]["path"] = json!("../SKILL.md");
            }),
        ),
        (
            "unknown field",
            Box::new(|v| {
                v["installations"][0]["extra"] = json!(true);
            }),
        ),
    ];
    for (name, mutate) in cases {
        let mut value = valid.clone();
        mutate(&mut value);
        let result = Registry::parse(&value.to_string());
        assert!(
            matches!(result, Err(IntegrationError::Registry(_))),
            "{name} should be refused, got {result:?}"
        );
    }
}

#[test]
fn registry_read_reports_a_missing_file_as_none_and_leaves_broken_files_alone() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("integrations.json");
    assert_eq!(Registry::read(&path).unwrap(), None);

    let broken = r#"{"schemaVersion": 9, "installations": []}"#;
    std::fs::write(&path, broken).unwrap();
    assert_eq!(
        Registry::read(&path),
        Err(IntegrationError::UnknownSchema(9))
    );
    assert_eq!(std::fs::read_to_string(&path).unwrap(), broken);
}
