import type { ProjectId } from './contracts';
import { projectPath } from './http';

const BODY_PREFIX = 'attachments/';

/** The URL of an image sent with a message (`GET …/messages/{id}/attachments/{name}`). */
export function messageAttachmentUrl(
  projectId: ProjectId,
  messageId: string,
  name: string,
): string {
  return `${projectPath(projectId)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(name)}`;
}

/**
 * The URL for an image reference in a message body, which is written `attachments/<name>`.
 * Returns `null` for anything else (an external URL, a nested or relative path), so the caller
 * can leave it unresolved.
 */
export function resolveMessageImage(
  projectId: ProjectId,
  messageId: string,
  reference: string,
): string | null {
  if (!reference.startsWith(BODY_PREFIX)) return null;
  const name = reference.slice(BODY_PREFIX.length);
  if (name === '' || name.includes('/') || name.includes('\\')) return null;
  return messageAttachmentUrl(projectId, messageId, name);
}
