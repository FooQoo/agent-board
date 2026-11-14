//! `agboard open`: open the project's board in the browser. The server is
//! started in the background when none runs, as a command that waits starts
//! it; with `AGBOARD_AUTOSTART=0` a server must already run. The address is
//! always printed, and `--print` only prints it.

use serde_json::json;

use crate::cli::args::OpenArgs;
use crate::cli::{Context, Outcome};
use crate::error::AgboardError;
use crate::interact::browser;
use crate::paths::ServeInfo;

pub fn run(ctx: &Context, args: &OpenArgs) -> Result<Outcome, AgboardError> {
    let project = ctx.project()?;
    let info = serving(ctx)?;
    let url = browser::board_url(info.port, &project.id);
    // `None`: only printed; `Some(Err(why))`: not opened, and why.
    let opened = if args.print {
        None
    } else {
        Some(match browser::opener(&|name| std::env::var(name).ok()) {
            Ok(opener) => {
                opener
                    .open(&url)
                    .map_err(|reason| AgboardError::BrowserOpenFailed {
                        url: url.clone(),
                        reason,
                    })?;
                Ok(())
            }
            Err(why) => Err(why),
        })
    };
    let mut value = json!({
        "projectId": project.id,
        "url": url,
        "opened": matches!(opened, Some(Ok(()))),
    });
    let human = match opened {
        None => format!("{url}\n"),
        Some(Ok(())) => format!("Opened {url} in your browser.\n"),
        Some(Err(why)) => {
            value["notice"] = json!(why.reason());
            format!(
                "{url}\nThe browser was not opened. {} Open the address yourself.\n",
                why.reason()
            )
        }
    };
    Ok(Outcome {
        changed: false,
        human,
        json: value,
    })
}

/// The running server, started now when autostart allows it. A server started
/// here opens nothing by itself: this command opens the board.
fn serving(ctx: &Context) -> Result<ServeInfo, AgboardError> {
    let dir = ctx
        .files
        .shared_dir()
        .parent()
        .filter(|dir| !dir.as_os_str().is_empty())
        .unwrap_or_else(|| std::path::Path::new("."))
        .to_path_buf();
    if crate::autostart::enabled() {
        return crate::autostart::ensure_serving(&dir, None);
    }
    crate::paths::read_serve_info_in(&dir)
        .filter(crate::server::is_serving)
        .ok_or_else(|| AgboardError::BoardUnavailable {
            reason: "No server is running and AGBOARD_AUTOSTART=0 keeps one from starting. Run \"agboard serve -d\" first.".into(),
        })
}
