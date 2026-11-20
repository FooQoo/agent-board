import type { ProjectId } from '@/shared/api/contracts';
import { getJson, projectPath } from '@/shared/api/http';
import { postForm, postTask } from '@/shared/api/write';
import type { EditorAttachment } from '@/shared/ui/editor/attachmentTypes';
import { storedImageName } from '@/shared/ui/editor/storedImageName';
import {
  type AnswerItem,
  type MessageDetail,
  type MessagesApi,
  parseMessageDetail,
  parseSummaries,
} from './model/messages';

const messagePath = (projectId: ProjectId, messageId: string) =>
  `${projectPath(projectId)}/messages/${encodeURIComponent(messageId)}`;

/** One message of the project with its full text, options and state. */
export async function fetchMessage(
  projectId: ProjectId,
  messageId: string,
): Promise<MessageDetail> {
  return parseMessageDetail(await getJson<unknown>(messagePath(projectId, messageId)));
}

/** Sends a person's answers to questions of the project; the server writes all of them or none. */
export async function answerMessages(
  projectId: ProjectId,
  answers: AnswerItem[],
  attachments: readonly EditorAttachment[] = [],
) {
  const local = attachments.filter((a) => a.source === 'local' && a.file);
  const [only] = answers;
  if (local.length === 0 || answers.length !== 1 || !only) {
    return postTask<{ questions: unknown[] }>(`${projectPath(projectId)}/messages/answers`, {
      answers,
    });
  }
  // Images go with the one question answered, as `images.<questionId>` parts.
  const form = new FormData();
  form.append('metadata', JSON.stringify({ answers }));
  const taken = new Set<string>();
  for (const attachment of local) {
    const name = storedImageName(attachment, taken);
    taken.add(name.toLowerCase());
    form.append(`images.${only.questionId}`, attachment.file as File, name);
  }
  return postForm<{ questions: unknown[] }>(
    `${projectPath(projectId)}/messages/answers/multipart`,
    form,
  );
}

/** Takes back a request that no agent has picked up yet. */
export async function withdrawMessage(projectId: ProjectId, messageId: string) {
  return postTask<{ request: unknown }>(`${messagePath(projectId, messageId)}/withdraw`, {});
}

/** The periodic summaries of the project that were not dismissed, newest first. */
export async function fetchSummaries(projectId: ProjectId) {
  return parseSummaries(await getJson<unknown>(`${projectPath(projectId)}/summaries`));
}

/** Sets a periodic summary aside. The record stays in the project's `notify/` files. */
export async function dismissSummary(projectId: ProjectId, summaryId: string) {
  return postTask<{ summary: unknown }>(
    `${projectPath(projectId)}/summaries/${encodeURIComponent(summaryId)}/dismiss`,
    {},
  );
}

/** The routes of the PC board and of the phone screen served by the same app. */
export const messagesApi: MessagesApi = {
  read: fetchMessage,
  answer: answerMessages,
  withdraw: withdrawMessage,
  summaries: { list: fetchSummaries, dismiss: dismissSummary },
};
