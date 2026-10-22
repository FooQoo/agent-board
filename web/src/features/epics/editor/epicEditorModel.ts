import type { EditorAttachment, StoredAttachment } from '../../../shared/ui/editor/attachmentTypes';
import type { TaskSummary } from '../../../shared/api/contracts';

export type EpicSaveStep = 'images' | 'document' | 'details' | 'order';
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
