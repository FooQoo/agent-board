//! The Docs read routes over HTTP: the tree, a file and an image.

mod common;

use std::fs;
use std::path::PathBuf;

use common::Running;
use serde_json::{Value, json};

const PROJECT: &str = "0123456789abcdef0123456789abcdef";

struct Fixture {
    home: tempfile::TempDir,
    server: Running,
}

fn fixture() -> Fixture {
    let home = tempfile::tempdir().unwrap();
    let server = Running::start(home.path());
    Fixture { home, server }
}

impl Fixture {
    fn docs_dir(&self) -> PathBuf {
        self.home
            .path()
            .join("shared/projects")
            .join(PROJECT)
            .join("docs")
    }

    fn put(&self, path: &str, bytes: &[u8]) {
        let full = self.docs_dir().join(path);
        fs::create_dir_all(full.parent().unwrap()).unwrap();
        fs::write(full, bytes).unwrap();
    }

    fn get(&self, route: &str) -> common::Reply {
        self.server
            .get(&format!("/api/projects/{PROJECT}/docs/{route}"))
    }

    fn tree(&self) -> Value {
        let reply = self.get("tree");
        assert_eq!(reply.status, 200, "{}", reply.body);
        reply.json()
    }
}

fn names(nodes: &Value) -> Vec<String> {
    nodes
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n["name"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn a_missing_root_is_an_empty_tree() {
    let f = fixture();
    assert_eq!(f.tree(), json!({"nodes": [], "truncated": false}));
}

#[test]
fn the_tree_lists_names_in_order_without_content() {
    let f = fixture();
    f.put("b.md", b"secret body");
    f.put("A.MD", b"x");
    f.put("zeta/inner.md", b"x");
    f.put("alpha/deep/leaf.md", b"x");
    f.put("notes.txt", b"x");
    f.put("pic.png", b"x");
    let tree = f.tree();
    assert_eq!(tree["truncated"], false);
    assert_eq!(
        names(&tree["nodes"]),
        ["alpha", "zeta", "A.MD", "b.md", "notes.txt", "pic.png"]
    );
    let alpha = &tree["nodes"][0];
    assert_eq!(alpha["kind"], "dir");
    assert_eq!(alpha["path"], "alpha");
    let deep = &alpha["children"][0];
    assert_eq!(deep["path"], "alpha/deep");
    assert_eq!(deep["children"][0]["path"], "alpha/deep/leaf.md");
    assert_eq!(deep["children"][0]["kind"], "file");
    assert!(deep["children"][0].get("children").is_none());
    assert!(alpha.get("viewer").is_none());
    assert!(!tree.to_string().contains("secret body"));
}

#[test]
fn the_tree_names_how_each_file_is_shown() {
    let f = fixture();
    for name in [
        "a.md", "b.PNG", "c.jpg", "d.jpeg", "e.webp", "f.gif", "g.pen", "h.json", "i.txt", "noext",
        "j.svg", "k.avif", "l.MDX",
    ] {
        f.put(name, b"x");
    }
    let tree = f.tree();
    let viewers: Vec<(String, String)> = tree["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| {
            assert_eq!(n["kind"], "file");
            (
                n["name"].as_str().unwrap().to_string(),
                n["viewer"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    let expected = [
        ("a.md", "markdown"),
        ("b.PNG", "image"),
        ("c.jpg", "image"),
        ("d.jpeg", "image"),
        ("e.webp", "image"),
        ("f.gif", "image"),
        ("g.pen", "other"),
        ("h.json", "other"),
        ("i.txt", "other"),
        ("j.svg", "image"),
        ("k.avif", "image"),
        ("l.MDX", "markdown"),
        ("noext", "other"),
    ];
    let expected: Vec<(String, String)> = expected
        .iter()
        .map(|(n, v)| (n.to_string(), v.to_string()))
        .collect();
    assert_eq!(viewers, expected);
}

#[test]
fn a_file_that_is_not_markdown_has_no_text_to_open() {
    let f = fixture();
    f.put("pic.png", b"x");
    f.put("data.json", b"{}");
    for route in ["file?path=pic.png", "file?path=data.json"] {
        let reply = f.get(route);
        assert_eq!(reply.status, 415, "{route}");
        assert_eq!(reply.json()["error"]["code"], "docs_not_markdown");
    }
}

#[test]
fn the_tree_leaves_out_dot_names_and_links() {
    let f = fixture();
    f.put("keep.md", b"x");
    f.put(".hidden.md", b"x");
    f.put(".git/config.md", b"x");
    f.put("dir/.dot.md", b"x");
    f.put(".hidden.png", b"x");
    f.put("dir/.config.json", b"x");
    f.put("real/a.md", b"x");
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(f.docs_dir().join("keep.md"), f.docs_dir().join("link.md"))
            .unwrap();
        std::os::unix::fs::symlink(f.docs_dir().join("keep.md"), f.docs_dir().join("link.png"))
            .unwrap();
        std::os::unix::fs::symlink(f.docs_dir().join("real"), f.docs_dir().join("linkdir"))
            .unwrap();
    }
    let tree = f.tree();
    assert_eq!(names(&tree["nodes"]), ["dir", "real", "keep.md"]);
    assert_eq!(tree["nodes"][0]["children"], json!([]));
}

#[test]
fn the_tree_says_when_the_entry_limit_cut_it_short() {
    let f = fixture();
    let dir = f.docs_dir();
    fs::create_dir_all(&dir).unwrap();
    for i in 0..5_001 {
        fs::write(dir.join(format!("f{i:05}.md")), b"").unwrap();
    }
    let tree = f.tree();
    assert_eq!(tree["nodes"].as_array().unwrap().len(), 5_000);
    assert_eq!(tree["truncated"], true);
}

#[test]
fn exactly_the_entry_limit_is_not_truncated() {
    let f = fixture();
    let dir = f.docs_dir();
    fs::create_dir_all(&dir).unwrap();
    for i in 0..5_000 {
        fs::write(dir.join(format!("f{i:05}.md")), b"").unwrap();
    }
    let tree = f.tree();
    assert_eq!(tree["nodes"].as_array().unwrap().len(), 5_000);
    assert_eq!(tree["truncated"], false);
}

#[test]
fn the_tree_stops_at_the_depth_limit() {
    let f = fixture();
    // 16 folders deep is listed; the file inside the 16th is not.
    let sixteen = (1..=16)
        .map(|i| format!("d{i}"))
        .collect::<Vec<_>>()
        .join("/");
    f.put(&format!("{sixteen}/cut.md"), b"x");
    let tree = f.tree();
    assert_eq!(tree["truncated"], true);
    let mut node = &tree["nodes"][0];
    for _ in 1..16 {
        node = &node["children"][0];
    }
    assert_eq!(node["path"], sixteen);
    assert_eq!(node["children"], json!([]));

    // A file at level 16 is listed and is not a cut.
    let g = fixture();
    let fifteen = (1..=15)
        .map(|i| format!("d{i}"))
        .collect::<Vec<_>>()
        .join("/");
    g.put(&format!("{fifteen}/ok.md"), b"x");
    let tree = g.tree();
    assert_eq!(tree["truncated"], false);
}

#[test]
fn a_file_comes_back_with_its_revision() {
    let f = fixture();
    f.put("notes/a.md", "# Hi\r\nあ\n".as_bytes());
    let reply = f.get("file?path=notes/a.md");
    assert_eq!(reply.status, 200, "{}", reply.body);
    let body = reply.json();
    assert_eq!(body["path"], "notes/a.md");
    assert_eq!(body["content"], "# Hi\r\nあ\n");
    assert_eq!(body["readOnly"], false);
    assert_eq!(
        body["revision"],
        agent_board::docs::revision_of("# Hi\r\nあ\n".as_bytes())
    );
}

#[test]
fn the_bom_stays_in_the_content() {
    let f = fixture();
    f.put("b.md", b"\xEF\xBB\xBFtext");
    let body = f.get("file?path=b.md").json();
    assert_eq!(body["content"], "\u{feff}text");
    assert_eq!(
        body["revision"],
        agent_board::docs::revision_of(b"\xEF\xBB\xBFtext")
    );
}

#[cfg(unix)]
#[test]
fn a_file_without_write_permission_is_read_only() {
    use std::os::unix::fs::PermissionsExt;
    let f = fixture();
    f.put("ro.md", b"x");
    let path = f.docs_dir().join("ro.md");
    fs::set_permissions(&path, fs::Permissions::from_mode(0o444)).unwrap();
    assert_eq!(f.get("file?path=ro.md").json()["readOnly"], true);
}

#[test]
fn a_bad_file_request_gets_its_own_code() {
    let f = fixture();
    f.put("big.md", &vec![b'a'; 2 * 1024 * 1024 + 1]);
    f.put("edge.md", &vec![b'a'; 2 * 1024 * 1024]);
    f.put("bad.md", &[0xff, 0xfe, 0x41]);
    f.put("plain.txt", b"x");
    f.put("dir/x.md", b"x");
    for (route, status, code) in [
        ("file?path=big.md", 413, "docs_too_large"),
        ("file?path=bad.md", 422, "docs_not_utf8"),
        ("file?path=plain.txt", 415, "docs_not_markdown"),
        ("file?path=missing.md", 404, "docs_not_found"),
        ("file?path=dir.md", 404, "docs_not_found"),
        ("file?path=dir/x.md/y.md", 404, "docs_not_found"),
    ] {
        let reply = f.get(route);
        assert_eq!(
            (reply.status, reply.code()),
            (status, code.to_string()),
            "{route}"
        );
    }
    assert_eq!(f.get("file?path=edge.md").status, 200);
}

#[cfg(unix)]
#[test]
fn a_linked_file_or_folder_is_not_followed() {
    let f = fixture();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("s.md"), b"outside").unwrap();
    fs::create_dir_all(f.docs_dir()).unwrap();
    std::os::unix::fs::symlink(outside.path().join("s.md"), f.docs_dir().join("l.md")).unwrap();
    std::os::unix::fs::symlink(outside.path(), f.docs_dir().join("ld")).unwrap();
    for route in ["file?path=l.md", "file?path=ld/s.md"] {
        let reply = f.get(route);
        assert_eq!(
            (reply.status, reply.code()),
            (400, "docs_path_invalid".to_string()),
            "{route}"
        );
    }
}

#[test]
fn images_are_served_with_a_fixed_type() {
    let f = fixture();
    let png = common::png();
    for (file, content_type) in [
        ("a.png", "image/png"),
        ("B.JPG", "image/jpeg"),
        ("c.jpeg", "image/jpeg"),
        ("d.webp", "image/webp"),
        ("img/e.gif", "image/gif"),
        ("f.avif", "image/avif"),
    ] {
        f.put(file, &png);
        let reply = f.get(&format!("assets?path={file}"));
        assert_eq!(reply.status, 200, "{file}");
        assert_eq!(reply.bytes, png, "{file}");
        assert_eq!(reply.header("content-type"), Some(content_type), "{file}");
        assert_eq!(reply.header("x-content-type-options"), Some("nosniff"));
        assert_eq!(reply.header("content-security-policy"), None, "{file}");
        // The router's /api/ layer replaces the handler's `no-cache` with `no-store`.
        assert!(
            matches!(reply.header("cache-control"), Some("no-cache" | "no-store")),
            "{file}"
        );
    }
}

#[test]
fn an_svg_is_served_with_a_policy_that_runs_no_script() {
    let f = fixture();
    let svg = b"<svg xmlns=\"http://www.w3.org/2000/svg\" onload=\"alert(1)\"/>";
    f.put("v.svg", svg);
    let reply = f.get("assets?path=v.svg");
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(reply.bytes, svg);
    assert_eq!(reply.header("content-type"), Some("image/svg+xml"));
    assert_eq!(reply.header("x-content-type-options"), Some("nosniff"));
    assert_eq!(
        reply.header("content-security-policy"),
        Some("default-src 'none'; style-src 'unsafe-inline'; sandbox")
    );
    f.put("big.svg", &vec![b'x'; 10 * 1024 * 1024 + 1]);
    assert_eq!(f.get("assets?path=big.svg").code(), "docs_too_large");
}

#[test]
fn an_mdx_file_is_read_like_markdown() {
    let f = fixture();
    let text = "import Chart from './chart.js'\n\n# Title\n\n<Chart year={2026} />\n";
    f.put("page.mdx", text.as_bytes());
    let reply = f.get("file?path=page.mdx");
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(reply.json()["content"], text);
}

#[test]
fn other_files_are_not_served_as_images() {
    let f = fixture();
    f.put("n.md", b"x");
    f.put("noext", b"x");
    for route in ["assets?path=n.md", "assets?path=noext"] {
        let reply = f.get(route);
        assert_eq!(
            (reply.status, reply.code()),
            (415, "docs_asset_type".to_string()),
            "{route}"
        );
    }
    assert_eq!(f.get("assets?path=gone.png").status, 404);
    for route in [
        "assets?path=../a.png",
        "assets?path=.git/a.png",
        "assets?path=/a.png",
    ] {
        assert_eq!(f.get(route).code(), "docs_path_invalid", "{route}");
    }
}

#[test]
fn an_image_over_its_limit_is_refused() {
    let f = fixture();
    f.put("big.png", &vec![0u8; 10 * 1024 * 1024 + 1]);
    f.put("edge.png", &vec![0u8; 10 * 1024 * 1024]);
    assert_eq!(f.get("assets?path=big.png").code(), "docs_too_large");
    assert_eq!(f.get("assets?path=edge.png").status, 200);
}

#[cfg(unix)]
#[test]
fn a_linked_image_is_not_followed() {
    let f = fixture();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("o.png"), common::png()).unwrap();
    fs::create_dir_all(f.docs_dir()).unwrap();
    std::os::unix::fs::symlink(outside.path().join("o.png"), f.docs_dir().join("l.png")).unwrap();
    assert_eq!(f.get("assets?path=l.png").code(), "docs_path_invalid");
}
