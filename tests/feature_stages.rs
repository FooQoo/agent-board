//! The documented feature stages match the product's list of preview
//! features.

use std::fs;
use std::path::Path;

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
    assert_eq!(in_product, ["docs", "remote-access", "listen"]);
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
        // Twelve GA features, and none of the preview ones among them.
        let rows = ga_rows(&page, ga);
        assert_eq!(rows.len(), 12, "{path}: {rows:#?}");
        for row in &rows {
            for name in [
                "Docs",
                "ドキュメント",
                "listen",
                "Remote access",
                "リモートアクセス",
            ] {
                let cell = row.split('|').nth(1).unwrap();
                assert!(!cell.contains(name), "{path}: {name} is listed as GA");
            }
        }
        assert!(page.contains(notice), "{path}: the adopted notice");
        // setup and update are GA, so the page no longer quotes a terminal line.
        assert!(!page.contains("Public preview: this command"), "{path}");
    }
}
