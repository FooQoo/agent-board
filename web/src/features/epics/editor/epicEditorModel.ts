import type { EditorAttachment, StoredAttachment } from '../../../shared/ui/editor/attachmentTypes';
import type { Epic, TaskSummary } from '../../../shared/api/contracts';
import { normalizeNewlines } from '../../../shared/ui/editor/limits';

/** The steps of a save, in order: images, the card order, and the epic itself in the last request. */
export type EpicSaveStep = 'images' | 'order' | 'epic';
export type EpicEditorPanel = 'progress' | 'images';

const NAME_LIMIT = 100;

/** The name is one line of up to 100 characters. */
export function nameIsValid(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && !/[\r\n]/.test(trimmed) && [...trimmed].length <= NAME_LIMIT;
}

/** The order of the tasks of an epic: the saved order first, then unlisted tasks by ID. */
export function orderOf(priority: readonly number[], members: readonly TaskSummary[]): number[] {
  const ids = new Set(members.map((task) => task.id));
  const listed = priority.filter((id) => ids.has(id));
  const rest = members
    .map((task) => task.id)
    .filter((id) => !listed.includes(id))
    .sort((a, b) => a - b);
  return [...listed, ...rest];
}

/** The server's view of an image the screen has just saved: its metadata only. */
export function storedOf({
  id,
  name,
  mediaType,
  size,
  createdAt,
}: EditorAttachment): StoredAttachment {
  return { id, name, mediaType, size, createdAt };
}

/** The savable fields as one string: name, color, text, image IDs, and the card order. */
export function epicSnapshot(fields: {
  name: string;
  color: string;
  document: string;
  imageIds: readonly string[];
  order: readonly number[];
}): string {
  return JSON.stringify([
    fields.name.trim(),
    fields.color.toUpperCase(),
    normalizeNewlines(fields.document),
    [...fields.imageIds].sort(),
    fields.order,
  ]);
}

/** The snapshot of an epic as the server holds it, with its cards in the order the dialog shows. */
export function snapshotOfEpic(epic: Epic, members: readonly TaskSummary[]): string {
  return epicSnapshot({
    name: epic.name,
    color: epic.color,
    document: epic.priorityError ? epic.document : epic.body,
    imageIds: epic.attachments.map((attachment) => attachment.id),
    order: orderOf(epic.priority, members),
  });
}
