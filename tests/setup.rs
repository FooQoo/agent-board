//! `agboard setup` run as the real binary. Every run gets a cleared environment
//! and a temporary HOME, so neither the real home nor the real data directory
//! is reachable. Sentinel contents in the agent settings must survive.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;

const CODEX_SENTINEL: &str = "# keep this comment\nmodel = \"gpt-sentinel\"\nsandbox_mode = \"workspace-write\"\n\n[sandbox_workspace_write]\n# other roots stay\nwritable_roots = [\"/sentinel/other\"]\nnetwork_access = false\n\n[tui]\ntheme = \"sentinel\"\n";

const CLAUDE_SENTINEL: &str = r#"{"model":"sentinel-model","permissions":{"allow":["Read"],"ask":["Bash(git push:*)"],"deny":["Read(.env)"],"defaultMode":"acceptEdits","additionalDirectories":["/sentinel/other"]},"hooks":{"Stop":[{"hooks":[{"type":"command","command":"sentinel-hook"}]}]},"futureKey":{"kept":true}}"#;

/// Runs `agboard setup` with a cleared environment: HOME is `home`, and only
/// `extra` variables are added. Returns exit code, stdout, and stderr.
fn setup(home: &Path, extra: &[(&str, &str)], args: &[&str]) -> (i32, String, String) {
    let output = Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env_clear()
        .env("HOME", home)
        .env("TZ", "UTC")
        .current_dir(home)
        .args(args)
        .envs(extra.iter().copied())
        .stdin(std::process::Stdio::null())
        .output()
        .unwrap();
    (
        output.status.code().unwrap(),
        String::from_utf8(output.stdout).unwrap(),
        String::from_utf8(output.stderr).unwrap(),
    )
}

fn setup_json(home: &Path, extra: &[(&str, &str)], args: &[&str]) -> Value {
    let mut all = vec!["--json", "setup"];
    all.extend_from_slice(args);
    let (code, out, err) = setup(home, extra, &all);
    assert_eq!(code, 0, "setup failed: {err}");
    serde_json::from_str(&out).unwrap_or_else(|_| panic!("not JSON: {out}"))
}

/// Every file below `dir` with its bytes (symbolic links are followed).
fn snapshot(dir: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    fn walk(dir: &Path, out: &mut BTreeMap<PathBuf, Vec<u8>>) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries {
            let path = entry.unwrap().path();
            if path.is_dir() {
                walk(&path, out);
            } else if let Ok(bytes) = fs::read(&path) {
                out.insert(path, bytes);
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(dir, &mut out);
    out
}

fn backups_in(dir: &Path) -> Vec<String> {
    fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|name| name.contains("agboard-backup"))
        .collect()
}

/// A home with Codex (workspace-write) and Claude Code sentinel settings.
fn home_with_settings(name: &str) -> (tempfile::TempDir, PathBuf) {
    let tmp = tempfile::tempdir().unwrap();
    let home = tmp.path().join(name);
    fs::create_dir_all(home.join(".codex")).unwrap();
    fs::create_dir_all(home.join(".claude")).unwrap();
    fs::write(home.join(".codex/config.toml"), CODEX_SENTINEL).unwrap();
    fs::write(home.join(".claude/settings.json"), CLAUDE_SENTINEL).unwrap();
    (tmp, home)
}

fn data_root(home: &Path) -> PathBuf {
    home.join(".agent-board")
}

#[test]
fn default_root_is_directly_under_home_and_setup_creates_it() {
    let (_tmp, home) = home_with_settings("home");
    let json = setup_json(&home, &[], &[]);
    assert_eq!(json["dataDir"], data_root(&home).display().to_string());
    assert_eq!(
        json["sharedDir"],
        data_root(&home).join("shared").display().to_string()
    );
    assert_eq!(json["dryRun"], false);
    assert_eq!(json["restartRequired"], true);
    assert!(data_root(&home).join("shared").is_dir());
    // setup creates no project and no bindings
    assert!(!data_root(&home).join("shared/projects").exists());
    assert!(!data_root(&home).join("bindings.json").exists());
    let agents = json["agents"].as_array().unwrap();
    let names: Vec<&str> = agents
        .iter()
        .map(|a| a["agent"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["codex", "claude"]);
    for agent in agents {
        assert_eq!(agent["status"], "updated");
        assert_eq!(agent["changes"].as_array().unwrap().len(), 1);
    }
}

#[test]
fn json_output_has_the_documented_keys() {
    let (_tmp, home) = home_with_settings("home");
    let json = setup_json(&home, &[], &["--agent", "codex"]);
    let mut keys: Vec<&str> = json
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        [
            "agents",
            "dataDir",
            "dryRun",
            "restartRequired",
            "sharedDir"
        ]
    );
    let agent = &json["agents"][0];
    assert_eq!(agent["agent"], "codex");
    assert!(
        agent["configPath"]
            .as_str()
            .unwrap()
            .ends_with(".codex/config.toml")
    );
}

#[test]
fn human_output_is_english_and_names_the_next_step() {
    let (_tmp, home) = home_with_settings("home");
    let (code, out, _) = setup(&home, &[], &["setup"]);
    assert_eq!(code, 0);
    assert!(out.contains("Data directory:"), "{out}");
    assert!(out.contains("Codex: updated"), "{out}");
    assert!(out.contains("Claude Code: updated"), "{out}");
    assert!(
        out.contains("Start new Codex and Claude Code sessions"),
        "{out}"
    );
}

#[test]
fn agboard_home_overrides_the_default_and_an_empty_value_does_not() {
    let (tmp, home) = home_with_settings("home");
    let custom = tmp.path().join("custom data");
    let json = setup_json(
        &home,
        &[("AGBOARD_HOME", custom.to_str().unwrap())],
        &["--agent", "claude"],
    );
    assert_eq!(json["dataDir"], custom.display().to_string());
    assert!(custom.join("shared").is_dir());
    assert!(!data_root(&home).exists());

    let json = setup_json(
        &home,
        &[("AGBOARD_HOME", "")],
        &["--agent", "claude", "--dry-run"],
    );
    assert_eq!(json["dataDir"], data_root(&home).display().to_string());
}

#[test]
fn a_relative_agboard_home_is_resolved_to_an_absolute_path_once() {
    let (_tmp, home) = home_with_settings("home");
    let json = setup_json(
        &home,
        &[("AGBOARD_HOME", "relative-data")],
        &["--agent", "claude", "--dry-run"],
    );
    let data = json["dataDir"].as_str().unwrap();
    assert!(Path::new(data).is_absolute(), "{data}");
    assert!(data.ends_with("relative-data"), "{data}");
}

#[test]
fn unicode_and_spaces_in_the_home_path_are_written_correctly() {
    let (_tmp, home) = home_with_settings("ホーム 空白");
    let json = setup_json(&home, &[], &[]);
    let root = data_root(&home).display().to_string();
    assert_eq!(json["dataDir"], root);
    let codex = fs::read_to_string(home.join(".codex/config.toml")).unwrap();
    let parsed: toml_edit::DocumentMut = codex.parse().unwrap();
    assert_eq!(
        parsed["sandbox_workspace_write"]["writable_roots"][1].as_str(),
        Some(root.as_str())
    );
    let claude: Value =
        serde_json::from_str(&fs::read_to_string(home.join(".claude/settings.json")).unwrap())
            .unwrap();
    assert_eq!(claude["permissions"]["additionalDirectories"][1], root);
}

#[test]
fn the_existing_settings_and_sentinels_are_kept() {
    let (_tmp, home) = home_with_settings("home");
    setup_json(&home, &[], &[]);

    let codex = fs::read_to_string(home.join(".codex/config.toml")).unwrap();
    assert!(
        codex.starts_with("# keep this comment\nmodel = \"gpt-sentinel\"\n"),
        "{codex}"
    );
    assert!(codex.contains("# other roots stay"));
    assert!(codex.contains("\"/sentinel/other\""));
    assert!(codex.contains("network_access = false"));
    assert!(codex.contains("[tui]\ntheme = \"sentinel\""));
    assert!(codex.contains(&data_root(&home).display().to_string()));

    let claude: Value =
        serde_json::from_str(&fs::read_to_string(home.join(".claude/settings.json")).unwrap())
            .unwrap();
    assert_eq!(claude["model"], "sentinel-model");
    assert_eq!(claude["futureKey"], serde_json::json!({"kept": true}));
    assert_eq!(
        claude["hooks"]["Stop"][0]["hooks"][0]["command"],
        "sentinel-hook"
    );
    assert_eq!(claude["permissions"]["allow"], serde_json::json!(["Read"]));
    assert_eq!(
        claude["permissions"]["ask"],
        serde_json::json!(["Bash(git push:*)"])
    );
    assert_eq!(
        claude["permissions"]["deny"],
        serde_json::json!(["Read(.env)"])
    );
    assert_eq!(claude["permissions"]["defaultMode"], "acceptEdits");
    assert_eq!(
        claude["permissions"]["additionalDirectories"],
        serde_json::json!(["/sentinel/other", data_root(&home).display().to_string()])
    );
    let text = fs::read_to_string(home.join(".claude/settings.json")).unwrap();
    assert!(!text.contains("bypassPermissions"));
}

#[test]
fn dry_run_changes_nothing_and_creates_nothing() {
    let (_tmp, home) = home_with_settings("home");
    let before = snapshot(&home);
    let json = setup_json(&home, &[], &["--dry-run"]);
    assert_eq!(json["dryRun"], true);
    assert_eq!(json["restartRequired"], true);
    for agent in json["agents"].as_array().unwrap() {
        assert_eq!(agent["status"], "planned");
    }
    assert!(!data_root(&home).exists());
    assert_eq!(snapshot(&home), before, "dry run must not change any file");
    assert!(backups_in(&home.join(".codex")).is_empty());
    assert!(backups_in(&home.join(".claude")).is_empty());
}

#[test]
fn dry_run_in_a_home_without_settings_creates_no_agent_directories() {
    let tmp = tempfile::tempdir().unwrap();
    let home = tmp.path().join("bare home");
    fs::create_dir_all(&home).unwrap();
    let json = setup_json(&home, &[], &["--agent", "claude", "--dry-run"]);
    assert_eq!(json["agents"][0]["status"], "planned");
    assert!(!home.join(".claude").exists());
    assert!(!data_root(&home).exists());
}

#[test]
fn a_second_run_changes_nothing_and_adds_no_backup() {
    let (_tmp, home) = home_with_settings("home");
    setup_json(&home, &[], &[]);
    let after_first = snapshot(&home);
    let json = setup_json(&home, &[], &[]);
    for agent in json["agents"].as_array().unwrap() {
        assert_eq!(agent["status"], "unchanged");
        assert!(agent["backupPath"].is_null());
    }
    assert_eq!(json["restartRequired"], false);
    assert_eq!(
        snapshot(&home),
        after_first,
        "second run must write nothing"
    );
    assert_eq!(backups_in(&home.join(".codex")).len(), 1);
    assert_eq!(backups_in(&home.join(".claude")).len(), 1);
}

#[test]
fn an_updated_file_is_backed_up_first_with_the_original_bytes() {
    let (_tmp, home) = home_with_settings("home");
    setup_json(&home, &[], &[]);
    let backups = backups_in(&home.join(".codex"));
    assert_eq!(backups.len(), 1);
    let backup = fs::read_to_string(home.join(".codex").join(&backups[0])).unwrap();
    assert_eq!(backup, CODEX_SENTINEL);
    let claude_backups = backups_in(&home.join(".claude"));
    assert_eq!(
        fs::read_to_string(home.join(".claude").join(&claude_backups[0])).unwrap(),
        CLAUDE_SENTINEL
    );
}

#[cfg(unix)]
#[test]
fn file_modes_are_kept_for_the_settings_and_their_backups() {
    use std::os::unix::fs::PermissionsExt;
    let (_tmp, home) = home_with_settings("home");
    let codex = home.join(".codex/config.toml");
    fs::set_permissions(&codex, fs::Permissions::from_mode(0o640)).unwrap();
    setup_json(&home, &[], &["--agent", "codex"]);
    let mode = |path: &Path| fs::metadata(path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode(&codex), 0o640);
    let backup = home
        .join(".codex")
        .join(&backups_in(&home.join(".codex"))[0]);
    assert_eq!(mode(&backup), 0o640);
}

#[test]
fn a_single_agent_leaves_the_other_agent_untouched() {
    let (_tmp, home) = home_with_settings("home");
    let claude_before = fs::read(home.join(".claude/settings.json")).unwrap();
    let json = setup_json(&home, &[], &["--agent", "codex"]);
    assert_eq!(json["agents"].as_array().unwrap().len(), 1);
    assert_eq!(
        fs::read(home.join(".claude/settings.json")).unwrap(),
        claude_before
    );
    assert!(backups_in(&home.join(".claude")).is_empty());
}

#[test]
fn codex_home_and_claude_config_dir_overrides_are_honored() {
    let (tmp, home) = home_with_settings("home");
    let codex_home = tmp.path().join("codex elsewhere");
    let claude_dir = tmp.path().join("claude elsewhere");
    fs::create_dir_all(&codex_home).unwrap();
    fs::create_dir_all(&claude_dir).unwrap();
    fs::write(
        codex_home.join("config.toml"),
        "sandbox_mode = \"workspace-write\"\n",
    )
    .unwrap();
    fs::write(claude_dir.join("settings.json"), "{}").unwrap();
    let default_codex = fs::read(home.join(".codex/config.toml")).unwrap();
    let default_claude = fs::read(home.join(".claude/settings.json")).unwrap();

    setup_json(
        &home,
        &[
            ("CODEX_HOME", codex_home.to_str().unwrap()),
            ("CLAUDE_CONFIG_DIR", claude_dir.to_str().unwrap()),
        ],
        &[],
    );
    assert!(
        fs::read_to_string(codex_home.join("config.toml"))
            .unwrap()
            .contains(".agent-board")
    );
    assert!(
        fs::read_to_string(claude_dir.join("settings.json"))
            .unwrap()
            .contains(".agent-board")
    );
    assert_eq!(
        fs::read(home.join(".codex/config.toml")).unwrap(),
        default_codex
    );
    assert_eq!(
        fs::read(home.join(".claude/settings.json")).unwrap(),
        default_claude
    );
}

#[test]
fn empty_overrides_count_as_unset() {
    let (_tmp, home) = home_with_settings("home");
    let json = setup_json(
        &home,
        &[("CODEX_HOME", ""), ("CLAUDE_CONFIG_DIR", "")],
        &["--dry-run"],
    );
    let paths: Vec<&str> = json["agents"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["configPath"].as_str().unwrap())
        .collect();
    assert!(paths[0].ends_with(".codex/config.toml"), "{paths:?}");
    assert!(paths[1].ends_with(".claude/settings.json"), "{paths:?}");
}

#[test]
fn a_missing_claude_settings_file_is_created_with_private_permissions() {
    let tmp = tempfile::tempdir().unwrap();
    let home = tmp.path().join("home");
    fs::create_dir_all(&home).unwrap();
    let json = setup_json(&home, &[], &["--agent", "claude"]);
    assert_eq!(json["agents"][0]["status"], "updated");
    assert!(json["agents"][0]["backupPath"].is_null());
    let text = fs::read_to_string(home.join(".claude/settings.json")).unwrap();
    let value: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(
        value["permissions"]["additionalDirectories"],
        serde_json::json!([data_root(&home).display().to_string()])
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(home.join(".claude/settings.json"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}

#[test]
fn a_codex_config_without_workspace_write_is_refused_and_nothing_is_written() {
    for text in [
        "model = \"gpt\"\n",
        "sandbox_mode = \"read-only\"\n",
        "sandbox_mode = \"workspace-write\"\ndefault_permissions = \"custom\"\n",
        "sandbox_mode = \"workspace-write\"\n[permissions.custom]\n",
    ] {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path().join("home");
        fs::create_dir_all(home.join(".codex")).unwrap();
        fs::create_dir_all(home.join(".claude")).unwrap();
        fs::write(home.join(".codex/config.toml"), text).unwrap();
        fs::write(home.join(".claude/settings.json"), CLAUDE_SENTINEL).unwrap();
        let before = snapshot(&home);

        let (code, _out, err) = setup(&home, &[], &["--json", "setup"]);
        assert_ne!(code, 0, "{text:?}");
        let value: Value = serde_json::from_str(&err).unwrap();
        assert_eq!(value["error"]["code"], "file_error", "{text:?}");
        assert!(
            value["error"]["reason"]
                .as_str()
                .unwrap()
                .contains("Manual setup"),
            "{err}"
        );
        assert_eq!(snapshot(&home), before, "{text:?} must change nothing");
        assert!(
            !data_root(&home).exists(),
            "validation runs before folders are created"
        );
    }
}

#[test]
fn an_invalid_settings_file_stops_the_whole_run_before_any_write() {
    let (_tmp, home) = home_with_settings("home");
    fs::write(home.join(".claude/settings.json"), "{ not json").unwrap();
    let before = snapshot(&home);
    let (code, _out, err) = setup(&home, &[], &["--json", "setup"]);
    assert_ne!(code, 0);
    let value: Value = serde_json::from_str(&err).unwrap();
    assert_eq!(value["error"]["code"], "file_invalid");
    assert_eq!(
        snapshot(&home),
        before,
        "the valid Codex file must not be written either"
    );
    assert!(!data_root(&home).exists());
}

#[test]
fn a_missing_codex_config_is_refused_and_creates_no_file() {
    let tmp = tempfile::tempdir().unwrap();
    let home = tmp.path().join("home");
    fs::create_dir_all(&home).unwrap();
    let (code, _out, err) = setup(&home, &[], &["setup", "--agent", "codex"]);
    assert_ne!(code, 0);
    assert!(err.contains("sandbox_mode is not set"), "{err}");
    assert!(!home.join(".codex").exists());
}

#[test]
fn a_failure_while_writing_restores_the_files_already_written() {
    use std::os::unix::fs::PermissionsExt;
    let (_tmp, home) = home_with_settings("home");
    // The Claude directory is readable but not writable: the Codex file is
    // written first, then the Claude backup cannot be created.
    let claude_dir = home.join(".claude");
    fs::set_permissions(&claude_dir, fs::Permissions::from_mode(0o500)).unwrap();
    let before = snapshot(&home);
    let (code, _out, err) = setup(&home, &[], &["--json", "setup"]);
    fs::set_permissions(&claude_dir, fs::Permissions::from_mode(0o700)).unwrap();
    assert_ne!(code, 0, "{err}");
    let value: Value = serde_json::from_str(&err).unwrap();
    assert_eq!(value["error"]["code"], "file_error");
    assert_eq!(snapshot(&home), before, "the Codex file must be restored");
    assert!(
        backups_in(&home.join(".codex")).is_empty(),
        "restored backups are removed"
    );
}

#[cfg(unix)]
#[test]
fn a_symbolic_link_is_followed_and_kept_as_a_link() {
    let tmp = tempfile::tempdir().unwrap();
    let home = tmp.path().join("home");
    let dotfiles = tmp.path().join("dotfiles repo");
    fs::create_dir_all(home.join(".claude")).unwrap();
    fs::create_dir_all(home.join(".codex")).unwrap();
    fs::create_dir_all(&dotfiles).unwrap();
    fs::write(home.join(".codex/config.toml"), CODEX_SENTINEL).unwrap();
    fs::write(dotfiles.join("settings.json"), CLAUDE_SENTINEL).unwrap();
    std::os::unix::fs::symlink(
        dotfiles.join("settings.json"),
        home.join(".claude/settings.json"),
    )
    .unwrap();

    setup_json(&home, &[], &["--agent", "claude"]);

    let link = home.join(".claude/settings.json");
    assert!(
        fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink(),
        "link must stay a link"
    );
    let target = fs::read_to_string(dotfiles.join("settings.json")).unwrap();
    assert!(target.contains(".agent-board"));
    // the backup sits next to the real file
    assert_eq!(backups_in(&dotfiles).len(), 1);
    assert!(backups_in(&home.join(".claude")).is_empty());
}

#[cfg(unix)]
#[test]
fn a_dangling_symbolic_link_is_refused() {
    let tmp = tempfile::tempdir().unwrap();
    let home = tmp.path().join("home");
    fs::create_dir_all(home.join(".claude")).unwrap();
    std::os::unix::fs::symlink(
        tmp.path().join("missing.json"),
        home.join(".claude/settings.json"),
    )
    .unwrap();
    let (code, _out, err) = setup(&home, &[], &["--json", "setup", "--agent", "claude"]);
    assert_ne!(code, 0);
    assert_eq!(
        serde_json::from_str::<Value>(&err).unwrap()["error"]["code"],
        "file_error"
    );
    assert!(
        fs::symlink_metadata(home.join(".claude/settings.json"))
            .unwrap()
            .file_type()
            .is_symlink()
    );
    assert!(!data_root(&home).exists());
}

#[test]
fn the_old_os_application_folder_is_neither_read_nor_changed() {
    let (_tmp, home) = home_with_settings("home");
    let old = home.join("Library/Application Support/agboard");
    fs::create_dir_all(old.join("shared/projects")).unwrap();
    fs::write(old.join("shared/projects/sentinel.txt"), "old data").unwrap();
    fs::write(old.join("bindings.json"), "{\"sentinel\":true}").unwrap();
    let before = snapshot(&old);
    setup_json(&home, &[], &[]);
    assert_eq!(snapshot(&old), before);
    let json = setup_json(&home, &[], &["--dry-run"]);
    assert_eq!(json["dataDir"], data_root(&home).display().to_string());
    assert_eq!(snapshot(&old), before);
}

#[test]
fn setup_rejects_a_project_option_and_unknown_agents() {
    let (_tmp, home) = home_with_settings("home");
    let (code, _out, err) = setup(&home, &[], &["--project", "x", "setup"]);
    assert_eq!(code, 2, "{err}");
    let (code, _out, _err) = setup(&home, &[], &["setup", "--agent", "other"]);
    assert_eq!(code, 2);
}

#[test]
fn the_board_commands_use_the_same_root_as_setup() {
    let (_tmp, home) = home_with_settings("home");
    setup_json(&home, &[], &[]);
    let (code, _out, err) = setup(&home, &[], &["project", "create", "Demo"]);
    assert_eq!(code, 0, "{err}");
    assert!(data_root(&home).join("shared/projects").is_dir());
    let (code, out, _err) = setup(&home, &[], &["--json", "project", "ls"]);
    assert_eq!(code, 0);
    assert!(out.contains("Demo"), "{out}");
}

#[test]
fn serve_and_the_cli_share_the_default_root_created_by_setup() {
    use std::io::{BufRead, BufReader};
    let (_tmp, home) = home_with_settings("home");
    setup_json(&home, &[], &[]);
    let mut child = Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env_clear()
        .env("HOME", &home)
        .env("TZ", "UTC")
        .current_dir(&home)
        .args(["serve", "--port", "0"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let mut line = String::new();
    BufReader::new(child.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    // serve writes its registration into the same root the CLI reads
    let info = data_root(&home).join("serve.json");
    assert!(
        info.is_file(),
        "serve.json must be in {}",
        data_root(&home).display()
    );
    let _ = child.kill();
    let _ = child.wait();
    assert!(line.contains("Serving at"), "{line}");
}
