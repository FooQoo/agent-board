import type { Task } from '../../../shared/api/contracts.ts';
import type { MockBoard } from './boards.ts';
import type { MockContext, MockResponse } from './types.ts';
import { error, json, taskChangeOf } from './wire.ts';

/**
 * `POST .../messages/answers`: every answer is checked first and all are saved together, or none. The
 * mock keeps one question per waiting card, named by its request.
 */
export function answerQuestion(
  context: MockContext,
  found: MockBoard,
  body: Record<string, unknown>,
): MockResponse {
  const answers = Array.isArray(body.answers) ? body.answers : [];
  if (answers.length === 0) return error(422, 'validation', 'invalid answers.', 'Send an answer.');
  const at = context.now();
  const updates: { before: Task; after: Task }[] = [];
  for (const raw of answers) {
    const input = raw as Record<string, unknown> | null;
    if (typeof input !== 'object' || input === null)
      return error(422, 'validation', 'invalid answers.', 'Send an answer.');
    const id = input.questionId;
    const task = found.tasks.find((t) => t.agentStatus === 'pending' && t.pendingRequestId === id);
    if (!task)
      return error(404, 'message_not_found', `question ${String(id)} not found.`, 'Refresh.');
    const choiceId = typeof input.choiceId === 'string' ? input.choiceId : undefined;
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    if (text.length > 2000)
      return error(
        422,
        'validation',
        'invalid text.',
        'An answer up to 2,000 characters is allowed.',
      );
    if (choiceId === undefined && text === '')
      return error(422, 'validation', 'answer_empty.', 'Choose an option or write an answer.');
    const choice =
      choiceId === undefined ? undefined : task.pendingChoices.find((item) => item.id === choiceId);
    if (choiceId !== undefined && !choice)
      return error(
        422,
        'choice_unknown',
        'the choice is not part of this request.',
        'Choose one of the options of the request.',
      );
    updates.push({
      before: task,
      after: {
        ...task,
        agentStatus: 'idle',
        pendingReason: null,
        pendingRequestId: null,
        pendingChoices: [],
        updatedAt: at,
        agentStatusChangedAt: at,
        history: [
          ...task.history,
          { at, reason: [choice?.label, text].filter(Boolean).join(' — ') },
        ],
      },
    });
  }
  context.replaceTasks(
    found,
    updates.map((item) => item.after),
    updates.map((item) => taskChangeOf(item.before, item.after, ['summary', 'history'])),
  );
  return json(200, {
    questions: updates.map((item) => ({ id: item.before.pendingRequestId, status: 'answered' })),
  });
}
