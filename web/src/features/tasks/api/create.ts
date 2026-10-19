import type { AcceptanceItem, Assignee, ProjectId, Task } from '../../../shared/api/contracts';
import { projectPath } from '../../../shared/api/http';
import { multipartBody, postTask, sendMultipart } from '../../../shared/api/write';
import type { EditorAttachment } from '../../../shared/ui/editor/attachmentTypes';

/**
 * A new card. Give either `description` (the whole TASK.md text) or `body` with `acceptance`; the server
 * writes the frontmatter from the parts.
 */
export async function createTask(
  projectId: ProjectId,
  input: {
    title: string;
    description?: string;
    body?: string;
    acceptance?: AcceptanceItem[];
    assignee: Assignee;
    isDraft?: boolean;
  },
) {
  return postTask<{ task: Task }>(`${projectPath(projectId)}/tasks`, {
    ...input,
    isDraft: input.isDraft ?? false,
  });
}

export function createTaskMultipart(
  projectId: ProjectId,
  input: {
    title: string;
    description: string;
    assignee: Assignee;
    isDraft?: boolean;
    requestId?: string;
    attachments: readonly EditorAttachment[];
  },
) {
  return sendMultipart(
    `${projectPath(projectId)}/tasks/multipart`,
    multipartBody(
      { ...input, requestId: input.requestId ?? crypto.randomUUID(), attachments: undefined },
      input.attachments,
    ),
    'POST',
  );
}

/** Creates a regular AI task from a request, with its epic and images published atomically. */
export function createSimpleTaskMultipart(
  projectId: ProjectId,
  input: {
    description: string;
    epicId: string | null;
    attachments: readonly EditorAttachment[];
  },
) {
  return sendMultipart(
    `${projectPath(projectId)}/tasks/multipart`,
    multipartBody(
      {
        requestKind: 'simple',
        description: input.description,
        epicId: input.epicId,
        attachments: undefined,
      },
      input.attachments,
    ),
    'POST',
  );
}

/**
 * Adds a card in one request: with its images when there are some (multipart), and as a draft when
 * `isDraft` is set. A refused request is not repeated here, so a failure never adds two cards.
 */
export async function createNewTask(
  projectId: ProjectId,
  input: {
    title: string;
    description: string;
    assignee: Assignee;
    isDraft?: boolean;
    requestId?: string;
    attachments?: readonly EditorAttachment[];
  },
) {
  const isDraft = input.isDraft ?? false;
  if (input.attachments?.length)
    return createTaskMultipart(projectId, {
      title: input.title,
      description: input.description,
      assignee: input.assignee,
      isDraft,
      requestId: input.requestId,
      attachments: input.attachments,
    });
  return createTask(projectId, {
    title: input.title,
    description: input.description,
    assignee: input.assignee,
    isDraft,
  });
}
