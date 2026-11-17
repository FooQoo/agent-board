//! `epic add|ls|show|edit|rm`: epics of the project named with `--project`.

use std::io::{BufRead, Write};

use serde_json::{Value, json};

use crate::cli::args::{
    EpicAddArgs, EpicArgs, EpicCommand, EpicEditArgs, EpicIdArgs, EpicStartArgs,
};
use crate::cli::{Context, Outcome};
use crate::domain::{Actor, Draft};
use crate::error::AgboardError;
use crate::file_store::model::{EpicUpdate, EpicView, NewEpic};
use crate::file_store::reader::ProjectSnapshot;
use crate::file_store::validate::EpicId;
use crate::interact::confirm;

pub fn run(ctx: &mut Context, args: &EpicArgs) -> Result<Outcome, AgboardError> {
    match &args.command {
        EpicCommand::Add(args) => add(ctx, args),
        EpicCommand::Ls => ls(ctx),
        EpicCommand::Show(args) => show(ctx, args),
        EpicCommand::Edit(args) => edit(ctx, args),
        EpicCommand::Start(args) => start(ctx, args),
        EpicCommand::Rm(args) => {
            ctx.interactive |= confirm::is_interactive(ctx.json);
            rm_with_io(
                ctx,
                args,
                &mut std::io::stdin().lock(),
                &mut std::io::stderr(),
            )
        }
    }
}

fn add(ctx: &mut Context, args: &EpicAddArgs) -> Result<Outcome, AgboardError> {
    // Epics keep no history, so the actor is only checked for presence; the
    // command line requires it.
    let actor = args.actor.actor();
    let epic = ctx.files.create_epic(
        ctx.project_id()?,
        NewEpic {
            id: args.id.clone(),
            name: args.name.clone(),
            color: args.color.clone(),
            // An epic an agent creates is a proposal until a person starts it.
            draft: (actor == Actor::Ai).then_some(Draft::Ai),
            document: None,
        },
        ctx.clock.now(),
    )?;
    Ok(Outcome {
        changed: true,
        human: format!("Created epic {} {}.\n", epic.id, epic.name),
        json: json!({"epic": epic}),
    })
}

/// The JSON of an epic in a list: its metadata and how many tasks name it,
/// archived ones included, as the delete rule counts them.
fn summary(epic: &EpicView, task_count: usize) -> Value {
    let mut value = serde_json::to_value(epic).expect("epics serialize");
    if let Value::Object(map) = &mut value {
        map.remove("document");
        map.insert("taskCount".into(), json!(task_count));
    }
    value
}

/// How many tasks of the snapshot name each epic, by EPIC-ID.
fn task_count(snapshot: &ProjectSnapshot, epic: &str) -> usize {
    snapshot
        .tasks
        .iter()
        .filter(|task| task.epic_id.as_deref() == Some(epic))
        .count()
}

fn ls(ctx: &mut Context) -> Result<Outcome, AgboardError> {
    let snapshot = ctx.files.snapshot(ctx.project_id()?)?;
    let mut epics = snapshot.epics.clone();
    epics.sort_by(|a, b| a.id.cmp(&b.id));
    if epics.is_empty() {
        return Ok(Outcome {
            changed: false,
            human: "No epics.\n".into(),
            json: json!({"epics": []}),
        });
    }
    let mut human = String::new();
    let mut listed = Vec::new();
    for epic in &epics {
        let count = task_count(&snapshot, epic.id.as_str());
        human.push_str(&format!(
            "{}  {}  {}{}  tasks: {}\n",
            epic.id,
            epic.name,
            epic.color,
            draft_label(epic.draft),
            count
        ));
        listed.push(summary(epic, count));
    }
    Ok(Outcome {
        changed: false,
        human,
        json: json!({"epics": listed}),
    })
}

fn show(ctx: &mut Context, args: &EpicIdArgs) -> Result<Outcome, AgboardError> {
    let id = EpicId::normalize(&args.id)?;
    let project = ctx.project_id()?;
    let epic = ctx.files.epic(project, &id)?;
    let tasks = task_count(&ctx.files.snapshot(project)?, id.as_str());
    let mut human = format!(
        "{}  {}\nColor: {}\nDraft: {}\nTasks: {}\n\n{}",
        epic.id,
        epic.name,
        epic.color,
        draft_name(epic.draft),
        tasks,
        epic.document
    );
    if !human.ends_with('\n') {
        human.push('\n');
    }
    Ok(Outcome {
        changed: false,
        human,
        json: json!({"epic": epic}),
    })
}

fn edit(ctx: &mut Context, args: &EpicEditArgs) -> Result<Outcome, AgboardError> {
    let id = EpicId::normalize(&args.id)?;
    let mut stdin = std::io::stdin();
    let document = args.document.resolve(&mut stdin)?;
    let project = ctx.project_id()?;
    let mut changed = false;
    let mut epic = None;
    if args.name.is_some() || args.color.is_some() || document.is_some() {
        let result = ctx.files.update_epic(
            project,
            &id,
            EpicUpdate {
                name: args.name.clone(),
                color: args.color.clone(),
                draft: None,
                document,
                refuse_if_draft: true,
            },
            ctx.clock.now(),
        )?;
        changed |= result.changed;
        epic = Some(result.value);
    }
    if let Some(text) = &args.priority {
        let priority = parse_priority(text)?;
        let result = ctx
            .files
            .set_epic_priority(project, &id, &priority, true, ctx.clock.now())?;
        changed |= result.changed;
        epic = Some(result.value);
    }
    let epic = match epic {
        Some(epic) => epic,
        None => ctx.files.epic(project, &id)?,
    };
    let human = if changed {
        format!("Updated epic {id}.\n")
    } else {
        format!("Epic {id} is unchanged.\n")
    };
    Ok(Outcome {
        changed,
        human,
        json: json!({"epic": epic}),
    })
}

/// The `--priority` list: task IDs separated by commas. Empty clears the order.
fn parse_priority(text: &str) -> Result<Vec<i64>, AgboardError> {
    let text = text.trim();
    if text.is_empty() {
        return Ok(Vec::new());
    }
    text.split(',')
        .map(|part| {
            part.trim()
                .parse::<i64>()
                .map_err(|_| AgboardError::InvalidValue {
                    field: "priority".to_string(),
                    reason: "Use task IDs separated by commas, for example 24,26,25.".to_string(),
                })
        })
        .collect()
}

/// Delete an epic after a person confirms it at a terminal. The epic must
/// exist, and the store refuses it while a task names it (`epic_in_use`).
pub fn rm_with_io(
    ctx: &Context,
    args: &EpicIdArgs,
    input: &mut impl BufRead,
    output: &mut impl Write,
) -> Result<Outcome, AgboardError> {
    let id = EpicId::normalize(&args.id)?;
    let project = ctx.project_id()?;
    ctx.files.epic(project, &id)?;
    if ctx.json || !ctx.interactive {
        return Err(AgboardError::ConfirmationRequired {
            operation: "deleting an epic".into(),
        });
    }
    if !confirm::confirm(
        &format!("Delete epic {id}? This cannot be undone."),
        input,
        output,
    )? {
        return Ok(Outcome {
            changed: false,
            human: "Cancelled. Nothing was changed.\n".into(),
            json: json!({"cancelled": true}),
        });
    }
    ctx.files.delete_epic(project, &id)?;
    Ok(Outcome {
        changed: true,
        human: format!("Deleted epic {id}.\n"),
        json: json!({"deleted": id.to_string()}),
    })
}

fn draft_label(draft: Option<Draft>) -> &'static str {
    match draft {
        None => "",
        Some(Draft::Human) => " [draft]",
        Some(Draft::Ai) => " [AI draft]",
    }
}

fn draft_name(draft: Option<Draft>) -> &'static str {
    match draft {
        None => "no",
        Some(Draft::Human) => "human",
        Some(Draft::Ai) => "ai",
    }
}

fn start(ctx: &mut Context, args: &EpicStartArgs) -> Result<Outcome, AgboardError> {
    let id = EpicId::normalize(&args.id)?;
    let project = ctx.project_id()?;
    let result = ctx
        .files
        .start_epic(project, &id, args.actor.actor(), ctx.clock.now())?;
    let started = &result.value.started;
    let human = if result.changed {
        format!("Started epic {} and {} task(s).\n", id, started.len())
    } else {
        format!("Epic {id} has nothing to start.\n")
    };
    Ok(Outcome {
        changed: result.changed,
        human,
        json: json!({"epic": result.value.epic, "started": started}),
    })
}
