use super::*;

const ID: &str = "0123456789abcdef0123456789abcdef";

fn shared() -> PathBuf {
    PathBuf::from("/data/shared")
}

#[test]
fn canonical_project_files_map_to_their_project() {
    let id = ProjectId::from_str(ID).unwrap();
    let task = shared().join("projects").join(ID).join("tasks/1/TASK.md");
    assert_eq!(
        classify(&shared(), &task),
        Some(Target::Project(id.clone()))
    );
    let epic = shared()
        .join("projects")
        .join(ID)
        .join("epics/EPIC-1/EPIC.md");
    assert_eq!(classify(&shared(), &epic), Some(Target::Project(id)));
}

#[test]
fn dot_names_internal_files_and_the_readme_are_ignored() {
    let base = shared().join("projects").join(ID);
    for path in [
        base.join("tasks/1/.TASK.md.tmp-0123"),
        base.join(".internal/write.lock"),
        base.join("README.md"),
        shared().join("projects/.new-0123/project.json"),
        shared().join(".deleting-0123"),
    ] {
        assert_eq!(classify(&shared(), &path), None, "{}", path.display());
    }
}

#[test]
fn project_folders_and_the_workspace_file_reload_the_catalog() {
    assert_eq!(
        classify(&shared(), &shared().join("workspace.json")),
        Some(Target::All)
    );
    assert_eq!(
        classify(&shared(), &shared().join("projects").join(ID)),
        Some(Target::All)
    );
    assert_eq!(
        classify(&shared(), &shared().join("projects")),
        Some(Target::All)
    );
}

#[test]
fn the_docs_folder_and_everything_in_it_are_docs_not_board_data() {
    for rest in [
        "docs",
        "docs/a.md",
        "docs/sub/b.md",
        "docs/sub/tasks/1/TASK.md",
    ] {
        let path = shared().join("projects").join(ID).join(rest);
        assert_eq!(
            classify(&shared(), &path),
            Some(Target::Docs(ID.parse().unwrap())),
            "{rest}"
        );
    }
}

#[test]
fn paths_outside_the_shared_folder_are_ignored() {
    assert_eq!(
        classify(&shared(), Path::new("/elsewhere/projects/x")),
        None
    );
    assert_eq!(
        classify(
            &shared(),
            &shared().join("projects/not-an-id/tasks/1/TASK.md")
        ),
        None
    );
}
