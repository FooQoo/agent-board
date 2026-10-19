import { i18n } from '../../shared/i18n';
import type { ApiError, Epic, ProjectId } from '../../shared/api/contracts';
import { projectPath, readToken } from '../../shared/api/http';
import { writeFailure } from '../../shared/api/writeErrors';
import type { EditorAttachment } from '../../shared/ui/editor/attachmentTypes';

/** Sends a request whose answer is `{epic}` or an error body. */
async function sendEpic(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: FormData | Record<string, unknown>,
): Promise<{ epic: Epic }> {
  const isForm = body instanceof FormData;
  const response = await fetch(path, {
    method,
    headers: {
      ...(isForm || body === undefined ? {} : { 'Content-Type': 'application/json' }),
      'X-Agboard-Token': readToken(),
      'X-Agboard-Language': i18n.resolvedLanguage === 'ja' ? 'ja' : 'en',
    },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  const data = (await response.json()) as { epic?: Epic; error?: ApiError['error'] };
  if (!response.ok || data.epic === undefined)
    throw writeFailure(
      data.error?.reason ?? `Request failed (${response.status})`,
      response.status,
      data.error?.code ?? null,
      data.error?.message ?? null,
    );
  return { epic: data.epic };
}

/**
 * Deletes an epic. The server answers 204 when it is gone and refuses with `epic_in_use` while a task
 * (archived ones included) still names it.
 */
export async function deleteEpic(projectId: ProjectId, epicId: string): Promise<void> {
  const response = await fetch(`${projectPath(projectId)}/epics/${encodeURIComponent(epicId)}`, {
    method: 'DELETE',
    headers: { 'X-Agboard-Token': readToken() },
  });
  if (response.ok) return;
  const body = (await response.json().catch(() => ({}))) as { error?: ApiError['error'] };
  throw writeFailure(
    body.error?.reason ?? `Request failed (${response.status})`,
    response.status,
    body.error?.code ?? null,
    body.error?.message ?? null,
  );
}

/** The name, color, draft flag or plan of an epic. Only the given fields change. */
export function updateEpic(
  projectId: ProjectId,
  epicId: string,
  input: {
    name?: string;
    color?: string;
    isDraft?: boolean;
    plan?: string;
    body?: string;
    /** The card order of the epic: card IDs, first is first. */
    priority?: number[];
  },
) {
  return sendEpic('PATCH', `${projectPath(projectId)}/epics/${encodeURIComponent(epicId)}`, input);
}

/** Adds images to an epic. The IDs of the images are the ones the screen made, so a retry is the same write. */
export function addEpicAttachments(
  projectId: ProjectId,
  epicId: string,
  attachments: readonly EditorAttachment[],
  requestId: string,
) {
  const form = new FormData();
  form.append(
    'metadata',
    JSON.stringify({
      requestId,
      attachments: attachments.map((a) => ({ id: a.id, name: a.name })),
    }),
  );
  for (const attachment of attachments)
    if (attachment.file) form.append('file', attachment.file, attachment.name);
  return sendEpic(
    'POST',
    `${projectPath(projectId)}/epics/${encodeURIComponent(epicId)}/attachments`,
    form,
  );
}

/** Removes one image from an epic. */
export function deleteEpicAttachment(projectId: ProjectId, epicId: string, attachmentId: string) {
  return sendEpic(
    'DELETE',
    `${projectPath(projectId)}/epics/${encodeURIComponent(epicId)}/attachments/${encodeURIComponent(attachmentId)}`,
  );
}
