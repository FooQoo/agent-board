import '@/shared/i18n/question-flow-strings';
import { InfoIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { EditorShell } from '@/shared/ui/editor/EditorShell';
import { AnswerSteps, type AnswerStep } from './AnswerProgress';
import { AnswerReview, type AnswerReviewProps } from './AnswerReview';
import { DecisionAnswerPanel, type DecisionAnswerPanelProps } from './DecisionAnswerPanel';
import { QuestionLoading } from './QuestionLoading';
import { useLoadedFocus } from './useLoadedFocus';
import './decision-answer.css';
import './answer-flow.css';
import './answer-dialog.css';

/** What the dialog and the sheet show of a run through the questions. */
export interface AnswerFlowViewProps {
  /** The cards of the question shown: `#11`, `#14 #15`, or the no-task label. */
  identity: string;
  /** The card's title; the number of cards when several refer to the question; else the question's. */
  title: string;
  steps: readonly AnswerStep[];
  /** The step shown: an index into `steps`, or `steps.length` for the review. */
  current: number;
  /** How many answers are held. */
  answeredCount: number;
  /** The question and its answer; null while the question loads. */
  panel: DecisionAnswerPanelProps | null;
  /** The question cannot be shown yet: it is loading, or loading it failed. */
  loading: 'loading' | 'failed' | null;
  onReload: () => void;
  review: Omit<AnswerReviewProps, 'variant' | 'disabled'>;
  sending: boolean;
  /** Why the last send failed; the input stays, and sending again is offered. */
  failure: string | null;
  /** At least one held answer can be sent. */
  canSend: boolean;
  onPrev: () => void;
  onNext: () => void;
  onSend: () => void;
}

export interface DecisionAnswerDialogProps extends AnswerFlowViewProps {
  /** A step of the progress was chosen. */
  onStep: (index: number) => void;
  /** Where the focus goes on close when the opener is gone. */
  returnFocusSelector?: string;
  onClose: () => void;
}

/**
 * The PC answer dialog: the questions one after another, with their progress under the header, then
 * a review that sends every answer at once. The footer keeps the same two buttons in the same place
 * at every step.
 */
export function DecisionAnswerDialog({
  identity,
  title,
  steps,
  current,
  answeredCount,
  panel,
  loading,
  onReload,
  review,
  sending,
  failure,
  canSend,
  onPrev,
  onNext,
  onSend,
  onStep,
  returnFocusSelector,
  onClose,
}: DecisionAnswerDialogProps) {
  const { t } = useTranslation();
  const reviewing = current >= steps.length;
  const reviewed = review.items.filter((item) => item.state === 'answered').length;
  const loaded = panel !== null;
  useLoadedFocus('.decision-dialog', loaded);
  const hint = (
    <span className="decision-dialog__hint">
      <InfoIcon aria-hidden="true" />
      {t(reviewing ? 'questions.flow.reviewHint' : 'questions.flow.hint')}
    </span>
  );
  return (
    <EditorShell
      idLabel={reviewing ? undefined : identity}
      returnFocusSelector={returnFocusSelector}
      title={
        reviewing ? (
          <>
            {t('questions.flow.reviewTitle')}
            <span className="decision-dialog__subtitle">
              {reviewed === steps.length
                ? t('questions.flow.reviewAll', { count: reviewed })
                : t('questions.flow.reviewSome', { count: reviewed, total: steps.length })}
            </span>
          </>
        ) : (
          title
        )
      }
      badge={
        reviewing ? null : (
          <span className="decision-dialog__position">
            {t('questions.flow.position', { index: current + 1, total: steps.length })}
          </span>
        )
      }
      variant="edit"
      dirty={false}
      saving={sending}
      error={reviewing ? failure : null}
      onRetry={canSend ? onSend : undefined}
      onClose={onClose}
      status={hint}
      savingStatus={hint}
      footerClose={false}
      footerEnd={
        <span className="decision-dialog__count">
          {t('questions.flow.answeredCount', { count: answeredCount })}
        </span>
      }
      initialFocusSelector='[role="radio"], textarea, .answer-review__action'
      className="decision-dialog"
      actions={
        reviewing ? (
          <>
            <Button type="button" variant="outline" disabled={sending} onClick={onPrev}>
              {t('questions.flow.back')}
            </Button>
            <Button type="button" disabled={!canSend || sending} onClick={onSend}>
              {sending ? t('questions.flow.sending') : t('questions.flow.sendAll')}
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="outline" disabled={current === 0} onClick={onPrev}>
              {t('questions.flow.prev')}
            </Button>
            <Button type="button" onClick={onNext}>
              {t('questions.flow.next')}
            </Button>
          </>
        )
      }
    >
      <AnswerSteps steps={steps} current={current} onStep={onStep} />
      {reviewing ? (
        <div className="decision-dialog__review">
          <AnswerReview {...review} variant="dialog" disabled={sending} />
        </div>
      ) : panel === null ? (
        <QuestionLoading state={loading ?? 'loading'} onReload={onReload} />
      ) : (
        <DecisionAnswerPanel key={steps[current]?.id} {...panel} />
      )}
    </EditorShell>
  );
}
