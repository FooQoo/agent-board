//! `epic add|ls|show|edit|rm`: epics of the project named with `--project`.

use std::io::{BufRead, Write};

use serde_json::{Value, json};

use crate::cli::args::{
    EpicAddArgs, EpicArgs, EpicCommand, EpicEditArgs, EpicIdArgs, EpicSendArgs,
};
use crate::cli::{Context, Outcome};
use crate::domain::Draft;
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
        EpicCommand::Send(args) => send(ctx, args),
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
    let epic = ctx.files.create_epic(
        ctx.project_id()?,
        NewEpic {
            id: args.id.clone(),
            name: args.name.clone(),
            color: args.color.clone(),
            draft: None,
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
    if let Some(values) = &args.waves {
        let waves = parse_waves(values)?;
        let result = ctx
            .files
            .set_epic_waves(project, &id, &waves, true, ctx.clock.now())?;
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

/// The `--waves` values, one per wave: a task ID or task IDs joined by commas.
/// Blank values are dropped, so a single empty value clears the order.
fn parse_waves(values: &[String]) -> Result<Vec<Vec<i64>>, AgboardError> {
    let invalid = || {
        AgboardError::InvalidValue {
        field: "waves".to_string(),
        reason: "Give one value per wave, a task ID or task IDs joined by commas, for example --waves 24 25,26."
            .to_string(),
    }
    };
    let mut waves = Vec::new();
    for value in values.iter().filter(|value| !value.trim().is_empty()) {
        let wave = value
            .split(',')
            .map(|part| part.trim().parse::<i64>().map_err(|_| invalid()))
            .collect::<Result<Vec<i64>, AgboardError>>()?;
        waves.push(wave);
    }
    Ok(waves)
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
    }
}

fn draft_name(draft: Option<Draft>) -> &'static str {
    match draft {
        None => "no",
        Some(Draft::Human) => "human",
    }
}

fn send(ctx: &mut Context, args: &EpicSendArgs) -> Result<Outcome, AgboardError> {
    let id = EpicId::normalize(&args.id)?;
    let project = ctx.project_id()?;
    let actor = args.actor.actor();
    let ack = super::send::ack_of(actor, args.force)?;
    let only = args.tasks.as_deref().map(parse_task_ids).transpose()?;
    let result = ctx
        .files
        .send_epic(project, &id, only.as_deref(), actor, ack, ctx.clock.now())?;
    let sent = &result.value.sent;
    let human = if result.changed {
        format!("Sent {} task(s) of epic {} to Todo.\n", sent.len(), id)
    } else {
        format!("Epic {id} has nothing to send.\n")
    };
    Ok(Outcome {
        changed: result.changed,
        human,
        json: json!({"epic": result.value.epic, "sent": sent}),
    })
}

/// `--tasks 12,13`: task numbers joined by commas.
fn parse_task_ids(text: &str) -> Result<Vec<i64>, AgboardError> {
    let invalid = || AgboardError::InvalidValue {
        field: "tasks".into(),
        reason: "Give task numbers joined by commas, for example 12,13.".into(),
    };
    let ids: Vec<i64> = text
        .split(',')
        .map(|part| part.trim().parse::<i64>().map_err(|_| invalid()))
        .collect::<Result<_, _>>()?;
    if ids.is_empty() || ids.iter().any(|n| *n < 1) {
        return Err(invalid());
    }
    Ok(ids)
}
