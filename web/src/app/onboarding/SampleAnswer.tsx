// The answer form of the guide's sample question: the product's own list of messages (a modal on
// the PC, a bottom sheet on the phone) with one local question. Nothing is sent anywhere; Send only
// tells the guide to go on.

import { useMemo } from 'react';
import { MessagesSurface } from '../../features/tasks/messages/MessagesSurface';
import type { MessagesApi } from '../../features/tasks/messages/model/messages';
import type { Message } from '../../shared/data/api/contracts';
import { type GuideLocale, sampleQuestion } from './guideSamples';

const QUESTION_ID = 'Q-0';
const NOW = '2026-01-01T00:00:00.000Z';

export function SampleAnswer({
  phone,
  locale,
  onSend,
  onClose,
}: {
  /** The phone screen answers in its bottom sheet; the PC board in a dialog. */
  phone: boolean;
  locale: GuideLocale;
  /** The answer was sent: the guide resumes the second card. */
  onSend: () => void;
  /** The form was closed without sending; the question stays pending. */
  onClose: () => void;
}) {
  const { title, question, choices } = sampleQuestion(locale);
  const messages = useMemo<Message[]>(
    () => [
      {
        id: QUESTION_ID,
        type: 'question',
        from: 'ai',
        to: 'human',
        turn: 'human',
        title,
        createdAt: NOW,
        tasks: [],
        epicId: null,
      },
    ],
    [title],
  );
  const api = useMemo<MessagesApi>(
    () => ({
      read: () =>
        Promise.resolve({
          id: QUESTION_ID,
          type: 'question',
          body: question,
          choices,
          recommendedChoiceId: null,
          status: 'open',
          referencedBy: [],
        }),
      answer: () => {
        onSend();
        return Promise.resolve();
      },
      withdraw: () => Promise.reject(new Error('The guide has nothing to withdraw.')),
    }),
    [question, choices, onSend],
  );
  return (
    <MessagesSurface
      projectId="guide"
      messages={messages}
      kind={phone ? 'sheet' : 'dialog'}
      target={{ tab: 'fromAi', openId: QUESTION_ID }}
      api={api}
      onChanged={() => {}}
      onClose={onClose}
    />
  );
}
