import type { ProjectId } from '@/shared/api/contracts';
import { getJson, projectPath } from '@/shared/api/http';
import { postTask } from '@/shared/api/write';
import {
  type AnswerItem,
  type MessageDetail,
  type MessagesApi,
  parseMessageDetail,
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
export async function answerMessages(projectId: ProjectId, answers: AnswerItem[]) {
  return postTask<{ questions: unknown[] }>(`${projectPath(projectId)}/messages/answers`, {
    answers,
  });
}

/** Takes back a request that no agent has picked up yet. */
export async function withdrawMessage(projectId: ProjectId, messageId: string) {
  return postTask<{ request: unknown }>(`${messagePath(projectId, messageId)}/withdraw`, {});
}

/** The routes of the PC board and of the phone screen served by the same app. */
export const messagesApi: MessagesApi = {
  read: fetchMessage,
  answer: answerMessages,
  withdraw: withdrawMessage,
};
