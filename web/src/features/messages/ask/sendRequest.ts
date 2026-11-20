import type { ApiError, ProjectId } from '../../../shared/api/contracts';
import { authHeaders, projectPath } from '../../../shared/api/http';
import { writeFailure } from '../../../shared/api/writeErrors';
import { i18n } from '../../../shared/i18n';
import type { EditorAttachment } from '../../../shared/ui/editor/attachmentTypes';
import { storedImageName } from '../../../shared/ui/editor/storedImageName';

export { storedImageName };

/** The longest request the server keeps, in characters. */
export const REQUEST_LIMIT = 20_000;

/** The multipart body of a request: the `text` and one `images` part per picture. */
export function buildRequestForm(text: string, attachments: readonly EditorAttachment[]): FormData {
  const form = new FormData();
  const taken = new Set<string>();
  form.append('text', text);
  for (const attachment of attachments) {
    if (attachment.source !== 'local' || !attachment.file) continue;
    const name = storedImageName(attachment, taken);
    taken.add(name.toLowerCase());
    form.append('images', attachment.file, name);
  }
  return form;
}

/** Sends a request to the agents: `POST /api/projects/{id}/messages/requests`. */
export async function sendMessageRequest(
  projectId: ProjectId,
  input: { text: string; attachments: readonly EditorAttachment[] },
): Promise<void> {
  const response = await fetch(`${projectPath(projectId)}/messages/requests`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'X-Agboard-Language': i18n.resolvedLanguage === 'ja' ? 'ja' : 'en',
    },
    body: buildRequestForm(input.text, input.attachments),
  });
  if (response.ok) return;
  let error: ApiError['error'] | undefined;
  try {
    error = ((await response.json()) as { error?: ApiError['error'] }).error;
  } catch {
    error = undefined;
  }
  throw writeFailure(
    error?.reason ?? `Request failed (${response.status})`,
    response.status,
    error?.code ?? null,
    error?.message ?? null,
  );
}
