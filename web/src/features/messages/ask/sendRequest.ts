import type { ApiError, ProjectId } from '../../../shared/api/contracts';
import { authHeaders, projectPath } from '../../../shared/api/http';
import { writeFailure } from '../../../shared/api/writeErrors';
import { i18n } from '../../../shared/i18n';
import type { EditorAttachment } from '../../../shared/ui/editor/attachmentTypes';

/** The longest request the server keeps, in characters. */
export const REQUEST_LIMIT = 20_000;

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * The name the server stores an image under: plain ASCII (letters, digits, dot, underscore, hyphen),
 * at most 100 characters, ending with the extension of its type. A name already used gets a number.
 */
export function storedImageName(
  attachment: Pick<EditorAttachment, 'name' | 'mediaType'>,
  taken: ReadonlySet<string>,
): string {
  const extension = EXTENSIONS[attachment.mediaType] ?? 'png';
  const base = attachment.name.split(/[\\/]/).pop() ?? '';
  const lower = base.toLowerCase();
  const hasExtension =
    lower.endsWith(`.${extension}`) || (extension === 'jpg' && lower.endsWith('.jpeg'));
  const stem = (hasExtension ? base.slice(0, base.lastIndexOf('.')) : base)
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, 80);
  const plain = stem === '' ? 'image' : stem;
  for (let n = 1; ; n += 1) {
    const candidate = `${plain}${n === 1 ? '' : `-${n}`}.${extension}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * The multipart body of a request: the Markdown `text` and one `images` part per picture. Pictures
 * the text places with `attachment:<id>` are rewritten to `attachments/<stored name>`, the form the
 * server stores them under, so the sent text and the stored files agree.
 */
export function buildRequestForm(text: string, attachments: readonly EditorAttachment[]): FormData {
  const form = new FormData();
  const taken = new Set<string>();
  const names = new Map<string, string>();
  const files: { name: string; file: File }[] = [];
  for (const attachment of attachments) {
    if (attachment.source !== 'local' || !attachment.file) continue;
    const name = storedImageName(attachment, taken);
    taken.add(name.toLowerCase());
    names.set(attachment.id, name);
    files.push({ name, file: attachment.file });
  }
  const body = text.replace(/\]\(attachment:([0-9A-Za-z-]+)\)/g, (whole, id: string) => {
    const name = names.get(id);
    return name === undefined ? whole : `](attachments/${name})`;
  });
  form.append('text', body);
  for (const { name, file } of files) form.append('images', file, name);
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
