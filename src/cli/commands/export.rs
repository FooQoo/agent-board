use crate::cli::args::ExportArgs;
use crate::cli::{Context, Outcome};
use crate::{
    error::{FileAction, SkanError},
    transfer::Backup,
};
use serde_json::json;
use std::{fs, io::Write, path::PathBuf};

pub fn run(ctx: &mut Context, args: &ExportArgs) -> Result<Outcome, SkanError> {
    let destination = args
        .output
        .clone()
        .unwrap_or_else(|| PathBuf::from("skan.json"));
    let destination = if destination.is_dir() {
        destination.join("skan.json")
    } else {
        destination
    };
    let snapshot = ctx.legacy()?.export_snapshot(&ctx.legacy_project_id()?)?;
    let payloads = snapshot
        .cards
        .iter()
        .flat_map(|card| {
            card.attachments
                .iter()
                .map(move |a| (card.id, a.id.clone()))
        })
        .map(|(card_id, id)| {
            ctx.legacy()?
                .attachment_data_for_card(&snapshot.project.id, card_id, &id)
                .map(|data| (card_id, data))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let backup = Backup::from_export_snapshot_with_attachments(snapshot, payloads);
    let mut bytes = serde_json::to_vec_pretty(&backup).map_err(|e| SkanError::DatabaseError {
        reason: e.to_string(),
    })?;
    bytes.push(b'\n');
    let parent = destination
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| std::path::Path::new("."));
    fs::create_dir_all(parent).map_err(|e| file_error(&destination, e))?;
    let mut nonce = [0u8; 8];
    getrandom::fill(&mut nonce).map_err(|e| SkanError::DatabaseError {
        reason: e.to_string(),
    })?;
    let suffix = nonce.iter().map(|b| format!("{b:02x}")).collect::<String>();
    let tmp = destination.with_extension(format!("agboard-{}-{suffix}.tmp", std::process::id()));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp)
        .map_err(|e| file_error(&tmp, e))?;
    let result = (|| {
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&tmp, &destination)
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp);
        return Err(file_error(&destination, e));
    }
    Ok(Outcome {
        changed: false,
        human: format!("Exported board to {}.\n", destination.display()),
        json: json!({"path": destination}),
    })
}

fn file_error(path: &std::path::Path, error: std::io::Error) -> SkanError {
    SkanError::FileError {
        action: FileAction::Write,
        file: path.display().to_string(),
        reason: error.to_string(),
    }
}
