import type { AcceptanceItem, ProjectId } from '../../../shared/api/contracts';
import { projectPath } from '../../../shared/api/http';
import { multipartBody, postTask, sendMultipart, sendTask } from '../../../shared/api/write';
import type { EditorAttachment } from '../../../shared/ui/editor/attachmentTypes';
import type { AnswerInput } from '../answer/model/answer';
import type { Task } from '../../../shared/api/contracts';

export async function answerRequest(projectId: ProjectId, id: number, input: AnswerInput) {
  return postTask<{ task: Task; changed: boolean }>(
    `${projectPath(projectId)}/tasks/${id}/answer`,
    input,
  );
}

/**
 * Saves the title and/or description of a draft. Body and acceptance are partial inputs applied to
 * the latest TASK.md under the server's write lock; history is never sent by this editor. `finalize`
 * also hands the card back to the agents in the same step.
 */
export async function editTask(
  projectId: ProjectId,
  id: number,
  input: {
    title?: string;
    description?: string;
    body?: string;
    acceptance?: AcceptanceItem[];
    finalize?: boolean;
  },
) {
  return sendTask('PATCH', `${projectPath(projectId)}/tasks/${id}`, input);
}

export function editTaskMultipart(
  projectId: ProjectId,
  id: number,
  input: {
    title?: string;
    description?: string;
    finalize?: boolean;
    requestId?: string;
    attachments: readonly EditorAttachment[];
    removedAttachmentIds?: readonly string[];
  },
) {
  const { attachments, removedAttachmentIds = [], ...meta } = input;
  return sendMultipart(
    `${projectPath(projectId)}/tasks/${id}/multipart`,
    multipartBody(
      { ...meta, requestId: input.requestId ?? crypto.randomUUID() },
      attachments,
      removedAttachmentIds,
    ),
    'PATCH',
  );
}

/** Makes a card a draft (`true`) or finalizes it (`false`). Only an idle card can become a draft. */
export async function setDraft(projectId: ProjectId, id: number, isDraft: boolean) {
  return sendTask('PUT', `${projectPath(projectId)}/tasks/${id}/draft`, { isDraft });
}

/** Puts a card into the epic (`epicId`) or takes it out (`null`). */
export function setTaskEpic(projectId: ProjectId, id: number, epicId: string | null) {
  return sendTask('PUT', `${projectPath(projectId)}/tasks/${id}/epic`, { epicId });
}
