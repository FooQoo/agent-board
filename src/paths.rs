use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServeInfo {
    pub pid: u32,
    pub port: u16,
    pub started_at: String,
}

pub fn data_dir() -> PathBuf {
    todo!()
}

pub fn db_path() -> PathBuf {
    todo!()
}

pub fn serve_info_path() -> PathBuf {
    todo!()
}

pub fn read_serve_info() -> Option<ServeInfo> {
    todo!()
}

pub fn write_serve_info(_info: &ServeInfo) {
    todo!()
}

pub fn remove_serve_info() {
    todo!()
}
