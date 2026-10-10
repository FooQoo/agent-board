use crate::cli::args::LsArgs;
use crate::cli::{Context, Outcome};
use crate::clock::{Clock, format_utc};
use crate::file_store::model::CardView;
use crate::file_store::reader::AllSnapshots;
use crate::{domain::Column, error::SkanError};
use serde_json::json;

const COLUMNS: [Column; 3] = [Column::Todo, Column::Doing, Column::Done];

fn keep(args: &LsArgs, card: &CardView) -> bool {
    args.column.is_none_or(|c| card.card_status == c.column())
        && args
            .state
            .is_none_or(|s| card.agent_status == s.run_state())
}

pub fn run(ctx: &mut Context, args: &LsArgs) -> Result<Outcome, SkanError> {
    if args.all_projects {
        return run_all_projects(ctx, args);
    }
    let cards: Vec<CardView> = ctx
        .files
        .snapshot(ctx.project_id()?)?
        .cards
        .into_iter()
        .filter(|card| keep(args, card))
        .collect();
    let text = crate::cli::output::ls_text(&cards, &COLUMNS);
    Ok(Outcome {
        changed: false,
        human: text,
        json: json!({"cards": cards}),
    })
}

/// Every project's board from one read, with the filters applied to each
/// project's cards. A project with no matching card stays, with no cards.
fn run_all_projects(ctx: &mut Context, args: &LsArgs) -> Result<Outcome, SkanError> {
    let fetched_at = format_utc(ctx.clock.now());
    let mut all = ctx.files.all_snapshots()?;
    for project in &mut all.projects {
        project.cards.retain(|card| keep(args, card));
    }
    Ok(all_projects_outcome(&fetched_at, &all))
}

fn all_projects_outcome(fetched_at: &str, all: &AllSnapshots) -> Outcome {
    let human = if all.projects.is_empty() {
        super::project::NO_PROJECTS.to_string()
    } else {
        all.projects
            .iter()
            .map(|p| {
                format!(
                    "Project: {}\n{}",
                    p.project.name,
                    crate::cli::output::ls_text(&p.cards, &COLUMNS)
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    };
    Outcome {
        changed: false,
        human,
        json: json!({
            "fetchedAt": fetched_at,
            "catalogVersion": all.catalog_version,
            "projects": all.projects,
        }),
    }
}

/// The result when there is no shared folder: no projects and the catalog
/// version of an empty list.
pub fn empty_all_projects(clock: &dyn Clock) -> Outcome {
    let all = AllSnapshots {
        catalog_version: crate::file_store::index::catalog_version_of(std::iter::empty()),
        projects: Vec::new(),
    };
    all_projects_outcome(&format_utc(clock.now()), &all)
}
