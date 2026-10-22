//! The Docs routes of the board router: the tree, a file, a save and an image.
//! They are not on the mobile monitor's router. Each handler checks its input
//! and hands the work to `crate::docs`.

mod assets;
mod file_get;
mod file_put;
mod tree;

use axum::response::Response;
use serde::Deserialize;

use crate::docs::DocsRoot;
use crate::error::AgboardError;
use crate::server::response::agboard_error_response;
use crate::server::store::parse_project_id;

pub(super) use assets::get_docs_asset;
pub(super) use file_get::get_docs_file;
pub(super) use file_put::put_docs_file;
pub(super) use tree::get_docs_tree;

/// `?path=` of the file and image routes.
#[derive(Deserialize)]
pub(super) struct PathQuery {
    path: Option<String>,
}

impl PathQuery {
    pub(super) fn path(&self) -> &str {
        self.path.as_deref().unwrap_or("")
    }
}

/// The project's Docs folder from the URL's project ID.
fn docs_root(raw_project: &str) -> Result<DocsRoot, Box<Response>> {
    let project = parse_project_id(raw_project).map_err(failure)?;
    DocsRoot::for_project(&project).map_err(failure)
}

fn failure(error: AgboardError) -> Box<Response> {
    Box::new(agboard_error_response(&error))
}
