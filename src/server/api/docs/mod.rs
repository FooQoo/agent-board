//! The Docs routes of the board router: the tree, a file, a save, an image and
//! opening the folder.
//! They are not on the mobile monitor's router. Each handler checks its input
//! and hands the work to `crate::docs`.

mod assets;
mod file_get;
mod file_put;
mod open;
mod tree;

use axum::response::Response;
use serde::Deserialize;

use crate::error::AgboardError;
use crate::server::response::agboard_error_response;

pub(super) use assets::get_docs_asset;
pub(super) use file_get::get_docs_file;
pub(super) use file_put::put_docs_file;
pub(super) use open::open_docs_folder;
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

fn failure(error: AgboardError) -> Box<Response> {
    Box::new(agboard_error_response(&error))
}
