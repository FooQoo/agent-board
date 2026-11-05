import { addEpicAttachments, deleteEpic, deleteEpicAttachment, updateEpic } from '../api';
import type { Epic } from '../../../shared/api/contracts';
import type { EditorAttachment } from '../../../shared/ui/editor/attachmentTypes';

/**
 * What the last request of a save carries: the name, the color, and the whole text (the Markdown
 * body, or the whole document when the stored order cannot be read). `isDraft: false` finalizes
 * the draft the dialog entered; it is left out when the epic was a draft before the dialog opened.
 */
export type EpicSaveInput = { name: string; color: string; isDraft?: false } & (
  | { document: string }
  | { body: string }
);

/** The writes an epic dialog makes, one at a time and in the order used by the dialog. */
export interface EpicApi {
  /** Adds the new images to the epic; `requestId` makes a retry the same write. */
  addImages(files: EditorAttachment[], requestId: string): Promise<void>;
  removeImage(attachmentId: string): Promise<void>;
  /** Saves the card order of the epic: the IDs of its tasks, first is first. */
  savePriority(priority: number[]): Promise<void>;
  /** The last request of a save: name, color, text, and finalizing the draft. */
  save(input: EpicSaveInput): Promise<void>;
  /** Makes the epic a draft and returns what the server holds then. */
  enterDraft(): Promise<Epic>;
  /** Takes the draft back (discard); the history says the changes were discarded. */
  leaveDraft(): Promise<void>;
  /** Deletes the epic. The server refuses while a task still names it. */
  remove(): Promise<void>;
}

/**
 * The writes of one epic's dialog, bound to the project the dialog was opened in. `changed` runs
 * after each write that went through, so the board shows what was saved.
 */
export function epicApi(projectId: string, epicId: string, changed: () => void): EpicApi {
  const done = async <T>(write: Promise<T>): Promise<T> => {
    const result = await write;
    changed();
    return result;
  };
  return {
    addImages: async (files, requestId) => {
      await done(addEpicAttachments(projectId, epicId, files, requestId));
    },
    removeImage: async (attachmentId) => {
      await done(deleteEpicAttachment(projectId, epicId, attachmentId));
    },
    savePriority: async (priority) => {
      await done(updateEpic(projectId, epicId, { priority }));
    },
    save: async (input) => {
      await done(updateEpic(projectId, epicId, input));
    },
    enterDraft: async () => (await done(updateEpic(projectId, epicId, { isDraft: true }))).epic,
    leaveDraft: async () => {
      await done(updateEpic(projectId, epicId, { isDraft: false, discard: true }));
    },
    remove: () => done(deleteEpic(projectId, epicId)),
  };
}
