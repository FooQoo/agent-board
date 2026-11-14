import '@/shared/i18n/question-flow-strings';
import { CircleAlertIcon, CircleCheckIcon, CircleIcon, InfoIcon, PencilIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ClosedReason } from './model/answerBook';
import './answer-flow.css';

/** One question in the review: what was answered, or that it was not. */
export interface ReviewItem {
  id: string;
  /** `#11`, `#14 #15 #16`, or the no-task label. */
  identity: string;
  title: string;
  /** `answered`: it will be sent. `open`: no answer yet. `closed`: it cannot be sent. */
  state: 'answered' | 'open' | 'closed';
  choiceLabel: string | null;
  text: string;
  /** Why a closed answer cannot be sent. */
  closedReason?: ClosedReason | null;
}

export interface AnswerReviewProps {
  items: readonly ReviewItem[];
  /** `dialog`: rows in one frame, as on the PC. `sheet`: one card per question, as on a phone. */
  variant: 'dialog' | 'sheet';
  /** Returns to the question to change or give its answer. */
  onChange: (questionId: string) => void;
  /** Throws away an answer that can no longer be sent. */
  onDiscard: (questionId: string) => void;
  /** True while the answers are being sent. */
  disabled: boolean;
}

const CLOSED_TEXT: Record<ClosedReason, string> = {
  answered: 'questions.flow.closedAnswered',
  withdrawn: 'questions.flow.closedWithdrawn',
  gone: 'questions.flow.closedGone',
};

/** The review before sending: each question with its answer, and what sending does. */
export function AnswerReview({ items, variant, onChange, onDiscard, disabled }: AnswerReviewProps) {
  const { t } = useTranslation();
  const sep = variant === 'sheet' ? t('questions.flow.separator') : '';
  return (
    <div className="answer-review" data-variant={variant}>
      {variant === 'dialog' && (
        <h3 className="answer-review__heading">{t('questions.flow.reviewHeading')}</h3>
      )}
      <ul className="answer-review__list">
        {items.map((item) => {
          const Mark =
            item.state === 'answered'
              ? CircleCheckIcon
              : item.state === 'closed'
                ? CircleAlertIcon
                : CircleIcon;
          return (
            <li key={item.id} className="answer-review__item" data-state={item.state}>
              {variant === 'dialog' && <Mark className="answer-review__mark" aria-hidden="true" />}
              <div className="answer-review__body">
                <span className="answer-review__identity">{item.identity}</span>
                <span className="answer-review__title">{item.title}</span>
                {item.state === 'open' ? (
                  <span className="answer-review__line answer-review__line--missing">
                    {t('questions.flow.unanswered')}
                  </span>
                ) : (
                  <>
                    {item.choiceLabel !== null && (
                      <span className="answer-review__line">
                        <span className="answer-review__key">
                          {t('questions.flow.answerLabel')}
                          {sep}
                        </span>
                        {item.choiceLabel}
                      </span>
                    )}
                    {item.text.trim() !== '' && (
                      <span className="answer-review__line">
                        <span className="answer-review__key">
                          {t('questions.flow.noteLabel')}
                          {sep}
                        </span>
                        {item.text}
                      </span>
                    )}
                  </>
                )}
                {item.state === 'closed' && (
                  <span className="answer-review__closed" role="status">
                    {t(CLOSED_TEXT[item.closedReason ?? 'gone'])}
                  </span>
                )}
              </div>
              {item.state === 'closed' ? (
                <button
                  type="button"
                  className="answer-review__action"
                  disabled={disabled}
                  aria-label={`${t('questions.flow.discard')}: ${item.title}`}
                  onClick={() => onDiscard(item.id)}
                >
                  {t('questions.flow.discard')}
                </button>
              ) : (
                <button
                  type="button"
                  className="answer-review__action"
                  disabled={disabled}
                  aria-label={`${item.state === 'open' ? t('questions.flow.answerNow') : t('questions.flow.change')}: ${item.title}`}
                  onClick={() => onChange(item.id)}
                >
                  {variant === 'dialog' && <PencilIcon aria-hidden="true" />}
                  {item.state === 'open'
                    ? t('questions.flow.answerNow')
                    : t('questions.flow.change')}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="answer-review__notice">
        <InfoIcon aria-hidden="true" />
        <span>{t('questions.flow.reviewNotice')}</span>
      </p>
    </div>
  );
}
