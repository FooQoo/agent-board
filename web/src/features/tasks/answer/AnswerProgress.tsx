import '@/shared/i18n/question-flow-strings';
import { CheckIcon, SendIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './answer-flow.css';

export type AnswerStepState = 'answered' | 'open' | 'closed';

/** One question of the sequence, as the progress shows it. */
export interface AnswerStep {
  id: string;
  /** The question's title, shortened by the layout. */
  label: string;
  /** `answered`: an answer is held. `closed`: answered or withdrawn elsewhere; it cannot be sent. */
  state: AnswerStepState;
}

export interface AnswerProgressProps {
  steps: readonly AnswerStep[];
  /** The step shown: an index into `steps`, or `steps.length` for the review. */
  current: number;
  /** Opened from a card: there is no review step, so its mark is left out. */
  direct?: boolean;
}

function stateKey(state: AnswerStepState) {
  return state === 'answered'
    ? 'questions.flow.stateAnswered'
    : state === 'closed'
      ? 'questions.flow.stateClosed'
      : 'questions.flow.stateOpen';
}

/**
 * The PC dialog's progress: every question in order, then the review. An answered question has a
 * check; any step can be chosen, so a person can go back to any question.
 */
export function AnswerSteps({
  steps,
  current,
  direct = false,
  onStep,
}: AnswerProgressProps & { onStep: (index: number) => void }) {
  const { t } = useTranslation();
  const review = current === steps.length;
  return (
    <nav className="answer-steps" aria-label={t('questions.flow.progress')}>
      <ol className="answer-steps__list">
        {steps.map((step, index) => {
          const shown = index === current;
          return (
            <li key={step.id} className="answer-steps__entry">
              <button
                type="button"
                className="answer-steps__step"
                data-state={step.state}
                aria-current={shown ? 'step' : undefined}
                aria-label={t('questions.flow.step', {
                  label: step.label,
                  state: t(shown ? 'questions.flow.stateCurrent' : stateKey(step.state)),
                })}
                onClick={() => onStep(index)}
              >
                <span className="answer-steps__marker" aria-hidden="true">
                  {step.state === 'answered' && !shown ? <CheckIcon /> : index + 1}
                </span>
                <span className="answer-steps__label">{step.label}</span>
              </button>
            </li>
          );
        })}
        {!direct && (
          <li className="answer-steps__entry">
            <button
              type="button"
              className="answer-steps__step answer-steps__step--review"
              aria-current={review ? 'step' : undefined}
              onClick={() => onStep(steps.length)}
            >
              <span className="answer-steps__marker" aria-hidden="true">
                <SendIcon />
              </span>
              <span className="answer-steps__label">{t('questions.flow.reviewStep')}</span>
            </button>
          </li>
        )}
      </ol>
    </nav>
  );
}

/** The phone sheet's progress: a dot per question, the shown one long, then the review's mark. */
export function AnswerDots({ steps, current, direct = false }: AnswerProgressProps) {
  const { t } = useTranslation();
  return (
    <ol className="answer-dots" aria-label={t('questions.flow.progress')}>
      {steps.map((step, index) => (
        <li
          key={step.id}
          className="answer-dots__dot"
          data-state={step.state}
          aria-current={index === current ? 'step' : undefined}
          aria-label={t('questions.flow.step', {
            label: step.label,
            state: t(index === current ? 'questions.flow.stateCurrent' : stateKey(step.state)),
          })}
        />
      ))}
      {!direct && (
        <li
          className="answer-dots__review"
          aria-current={current === steps.length ? 'step' : undefined}
          aria-label={t('questions.flow.reviewStep')}
        >
          <SendIcon aria-hidden="true" />
        </li>
      )}
    </ol>
  );
}
