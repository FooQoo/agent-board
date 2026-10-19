import { addEpicAttachments, deleteEpic, deleteEpicAttachment, updateEpic } from '../api';
import type { EditorAttachment } from '../../../shared/ui/editor/attachmentTypes';

/** The writes an epic dialog makes, one at a time and in the order used by the dialog. */
export interface EpicApi {
  /** Adds the new images to the epic; `requestId` makes a retry the same write. */
  addImages(files: EditorAttachment[], requestId: string): Promise<void>;
  removeImage(attachmentId: string): Promise<void>;
  /** The whole plan text, or its Markdown body, saved in one request. */
  savePlan(input: { plan: string } | { body: string }): Promise<void>;
  saveDetails(details: { name: string; color: string; isDraft: boolean }): Promise<void>;
  /** Saves the card order of the epic: the IDs of its tasks, first is first. */
  savePriority(priority: number[]): Promise<void>;
  /** Deletes the epic. The server refuses while a task still names it. */
  remove(): Promise<void>;
}

/**
 * The writes of one epic's dialog, bound to the project the dialog was opened in. `changed` runs
 * after each write that went through, so the board shows what was saved.
 */
export function epicApi(projectId: string, epicId: string, changed: () => void): EpicApi {
  const done = async <T>(write: Promise<T>): Promise<void> => {
    await write;
    changed();
  };
  return {
    addImages: (files, requestId) => done(addEpicAttachments(projectId, epicId, files, requestId)),
    removeImage: (attachmentId) => done(deleteEpicAttachment(projectId, epicId, attachmentId)),
    savePlan: (plan) => done(updateEpic(projectId, epicId, plan)),
    saveDetails: (details) => done(updateEpic(projectId, epicId, details)),
    savePriority: (priority) => done(updateEpic(projectId, epicId, { priority })),
    remove: () => done(deleteEpic(projectId, epicId)),
  };
}
