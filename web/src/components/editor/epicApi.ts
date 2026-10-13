import { addEpicAttachments, deleteEpicAttachment, updateEpic } from '../../api';
import type { EpicApi } from './EpicDialog';

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
  };
}
