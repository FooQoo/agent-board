// The answer form of the guide's sample question: the product's own answer dialog (PC) or sheet
// (phone) with a local question. Nothing is sent anywhere; Send only tells the guide to go on.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DecisionAnswerDialog } from '../../features/tasks/answer/DecisionAnswerDialog';
import { DecisionAnswerSheet } from '../../features/tasks/answer/DecisionAnswerSheet';
import type { DecisionAnswerView } from '../../features/tasks/answer/decisionAnswerView';
import { type GuideLocale, sampleQuestion } from './guideSamples';

const noop = () => {};

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
  const { t } = useTranslation();
  const { title, question, choices } = sampleQuestion(locale);
  const [choiceId, setChoiceId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const hasInput = choiceId !== null || text.trim() !== '';
  const view: DecisionAnswerView = {
    choiceId,
    text,
    phase: 'editing',
    notice: null,
    failure: null,
    tooLong: false,
    sendable: hasInput,
    disabled: false,
    hasInput,
  };
  const flow = {
    identity: t('onboarding.sample.label'),
    title,
    steps: [{ id: 'guide-question', label: title, state: hasInput ? 'answered' : 'open' }] as const,
    current: 0,
    answeredCount: hasInput ? 1 : 0,
    panel: {
      question,
      choices,
      view,
      onChoiceChange: setChoiceId,
      onTextChange: setText,
      onClear: () => {
        setChoiceId(null);
        setText('');
      },
    },
    loading: null,
    onReload: noop,
    review: { items: [], onChange: noop, onDiscard: noop },
    sending: false,
    failure: null,
    canSend: hasInput,
    direct: true,
    onPrev: noop,
    onNext: noop,
    onSend,
  };
  return phone ? (
    <DecisionAnswerSheet
      {...flow}
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    />
  ) : (
    <DecisionAnswerDialog {...flow} onStep={noop} onClose={onClose} />
  );
}
