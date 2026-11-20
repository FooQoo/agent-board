import type { EditorAttachment, StoredAttachment } from '../../../shared/ui/editor/attachmentTypes';
import type { Epic, TaskSummary } from '../../../shared/api/contracts';
import { normalizeNewlines } from '../../../shared/ui/editor/limits';
import { normalizeWaves } from './waveModel';

/** The steps of a save, in order: images, the waves, and the epic itself in the last request. */
export type EpicSaveStep = 'images' | 'order' | 'epic';
export type EpicEditorPanel = 'progress' | 'images';

const NAME_LIMIT = 100;

/** The name is one line of up to 100 characters. */
export function nameIsValid(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && !/[\r\n]/.test(trimmed) && [...trimmed].length <= NAME_LIMIT;
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

/** The savable fields as one string: name, color, text, image IDs, and the waves. */
export function epicSnapshot(fields: {
  name: string;
  color: string;
  document: string;
  imageIds: readonly string[];
  waves: readonly (readonly number[])[];
}): string {
  return JSON.stringify([
    fields.name.trim(),
    fields.color.toUpperCase(),
    normalizeNewlines(fields.document),
    [...fields.imageIds].sort(),
    fields.waves,
  ]);
}

/** The snapshot of an epic as the server holds it, with its waves as the dialog shows them. */
export function snapshotOfEpic(epic: Epic, members: readonly TaskSummary[]): string {
  return epicSnapshot({
    name: epic.name,
    color: epic.color,
    document: epic.wavesError ? epic.document : epic.body,
    imageIds: epic.attachments.map((attachment) => attachment.id),
    waves: normalizeWaves(epic.waves, members),
  });
}
