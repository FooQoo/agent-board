//! `message send` and `message accept`: a person's request, and an agent's receipt of a request
//! or of an answer.

use serde_json::json;

use super::{Printed, invalid};
use crate::cli::Context;
use crate::cli::args::{MessageAcceptArgs, MessageSendArgs, read_reason};
use crate::domain::Actor;
use crate::error::{AgboardError, FileAction};
use crate::file_store::{Accepted, RequestImage, SendRequestInput};

fn read_image(path: &std::path::Path) -> Result<RequestImage, AgboardError> {
    let bytes = std::fs::read(path).map_err(|e| AgboardError::FileError {
        action: FileAction::Read,
        file: path.display().to_string(),
        reason: e.to_string(),
    })?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| invalid("send", "--image needs a file path."))?;
    Ok(RequestImage { name, bytes })
}

pub(super) fn send(ctx: &Context, args: &MessageSendArgs) -> Result<Printed, AgboardError> {
    let text = read_reason(args.text.as_deref(), args.text_file.as_deref())?
        .ok_or_else(|| invalid("send", "Give the request with --text or --text-file."))?;
    let images = args
        .images
        .iter()
        .map(|path| read_image(path))
        .collect::<Result<Vec<_>, _>>()?;
    let request = ctx.files.send_request(
        ctx.project_id()?,
        SendRequestInput { text, images },
        ctx.clock.now(),
    )?;
    Ok(Printed {
        changed: true,
        human: format!("Sent request {}.\n", request.id),
        json: json!({"request": request}),
    })
}

pub(super) fn accept(ctx: &Context, args: &MessageAcceptArgs) -> Result<Printed, AgboardError> {
    let accepted =
        ctx.files
            .accept_message(ctx.project_id()?, &args.id, Actor::Ai, ctx.clock.now())?;
    Ok(match accepted {
        Accepted::Request(request) => Printed {
            changed: true,
            human: format!("Accepted request {}.\n", request.id),
            json: json!({"request": request}),
        },
        Accepted::Question(question) => Printed {
            changed: true,
            human: format!("Accepted the answer of {}.\n", question.id),
            json: json!({"question": question}),
        },
    })
}
