import { i18n } from '../i18n';
import type { ApiError, Task } from './contracts';
import type { EditorAttachment } from '../ui/editor/attachmentTypes';
import { readToken } from './http';
import { writeFailure } from './writeErrors';

export async function postEmpty(path: string): Promise<{ task: Task }> {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'X-Agboard-Token': readToken(),
      'X-Agboard-Language': i18n.resolvedLanguage === 'ja' ? 'ja' : 'en',
    },
  });
  const body = (await response.json()) as { task?: Task; error?: ApiError['error'] };
  if (!response.ok || !body.task)
    throw writeFailure(
      body.error?.reason ?? `Request failed (${response.status})`,
      response.status,
      body.error?.code ?? null,
      body.error?.message ?? null,
    );
  return { task: body.task };
}

export async function postTask<T>(path: string, value: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Agboard-Token': readToken(),
      'X-Agboard-Language': i18n.resolvedLanguage === 'ja' ? 'ja' : 'en',
    },
    body: JSON.stringify(value),
  });
  const body = (await response.json()) as {
    task?: Task;
    changed?: boolean;
    error?: ApiError['error'];
  };
  if (!response.ok) {
    throw writeFailure(
      body.error?.reason ?? `Request failed (${response.status})`,
      response.status,
      body.error?.code ?? null,
      body.error?.message ?? null,
    );
  }
  return body as T;
}

export function multipartBody(
  meta: Record<string, unknown>,
  attachments: readonly EditorAttachment[],
  removed: readonly string[] = [],
) {
  const form = new FormData();
  const additions = attachments.filter((a) => a.source === 'local');
  form.append(
    'metadata',
    JSON.stringify({
      ...meta,
      removeAttachmentIds: removed,
      attachments: additions.map((a) => ({ id: a.id, name: a.name })),
    }),
  );
  for (const attachment of attachments)
    if (attachment.source === 'local' && attachment.file)
      form.append('file', attachment.file, attachment.name);
  return form;
}

export async function sendMultipart(path: string, body: FormData, method: 'POST' | 'PATCH') {
  const response = await fetch(path, {
    method,
    headers: {
      'X-Agboard-Token': readToken(),
      'X-Agboard-Language': i18n.resolvedLanguage === 'ja' ? 'ja' : 'en',
    },
    body,
  });
  const data = (await response.json()) as { task?: Task; error?: ApiError['error'] };
  if (!response.ok || !data.task)
    throw writeFailure(
      data.error?.reason ?? `Request failed (${response.status})`,
      response.status,
      data.error?.code ?? null,
      data.error?.message ?? null,
    );
  return { task: data.task };
}

/** Sends a write that answers `{card}` or an error body (PATCH and PUT). */
export async function sendTask(
  method: 'PATCH' | 'PUT',
  path: string,
  value: unknown,
): Promise<{ task: Task }> {
  const response = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Agboard-Token': readToken(),
      'X-Agboard-Language': i18n.resolvedLanguage === 'ja' ? 'ja' : 'en',
    },
    body: JSON.stringify(value),
  });
  const body = (await response.json()) as { task?: Task; error?: ApiError['error'] };
  if (!response.ok || body.task === undefined) {
    throw writeFailure(
      body.error?.reason ?? `Request failed (${response.status})`,
      response.status,
      body.error?.code ?? null,
      body.error?.message ?? null,
    );
  }
  return { task: body.task };
}
