import '@/shared/i18n/question-flow-strings';
import { CircleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Drawer } from '@/shared/ui/drawer';
import { AnswerDots } from './AnswerProgress';
import { AnswerReview } from './AnswerReview';
import type { AnswerFlowViewProps } from './DecisionAnswerDialog';
import { DecisionAnswerPanel } from './DecisionAnswerPanel';
import { QuestionLoading } from './QuestionLoading';
import { useLoadedFocus } from './useLoadedFocus';
import './decision-answer.css';
import './answer-flow.css';

export interface DecisionAnswerSheetProps extends AnswerFlowViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The monitor's answer sheet: the same run through the questions as the PC dialog, from the bottom.
 * The progress is a row of dots, and the two buttons share the bar below in equal halves.
 */
export function DecisionAnswerSheet({
  open,
  onOpenChange,
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
  direct = false,
  onPrev,
  onNext,
  onSend,
}: DecisionAnswerSheetProps) {
  const { t } = useTranslation();
  const reviewing = current >= steps.length;
  const sendsHere = reviewing || (direct && current === steps.length - 1);
  const reviewed = review.items.filter((item) => item.state === 'answered').length;
  useLoadedFocus('.decision-sheet-popup', panel !== null);
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!sending) onOpenChange(next);
      }}
      identity={
        reviewing ? null : (
          <>
            <span className="decision-sheet__position">
              {t('questions.flow.position', { index: current + 1, total: steps.length })}
            </span>
            <span>{identity}</span>
          </>
        )
      }
      title={reviewing ? t('questions.flow.reviewTitle') : title}
      label={
        <div className="decision-sheet__progress">
          <AnswerDots steps={steps} current={current} direct={direct} />
          <span className="decision-sheet__count">
            {reviewing
              ? reviewed === steps.length
                ? t('questions.flow.reviewAll', { count: reviewed })
                : t('questions.flow.reviewSome', { count: reviewed, total: steps.length })
              : t('questions.flow.answeredUnsent', { count: answeredCount })}
          </span>
        </div>
      }
      closeLabel={t('answer.sheetClose')}
      dismissLabel={t('answer.sheetDismiss')}
      className="decision-sheet-popup"
      initialFocusSelector='[role="radio"], textarea, .answer-review__action'
    >
      <div className="decision-sheet">
        {reviewing ? (
          <div className="decision-sheet__review">
            <AnswerReview {...review} variant="sheet" disabled={sending} />
          </div>
        ) : panel === null ? (
          <QuestionLoading state={loading ?? 'loading'} onReload={onReload} />
        ) : (
          <DecisionAnswerPanel key={steps[current]?.id} {...panel} />
        )}
        {sendsHere && failure !== null && (
          <div className="decision-sheet__failure" role="alert">
            <CircleAlertIcon aria-hidden="true" />
            <span>{failure}</span>
          </div>
        )}
        <div className="decision-sheet__bar">
          {reviewing ? (
            <>
              <Button type="button" variant="outline" size="l" disabled={sending} onClick={onPrev}>
                {t('questions.flow.back')}
              </Button>
              <Button type="button" size="l" disabled={!canSend || sending} onClick={onSend}>
                {sending ? t('questions.flow.sending') : t('questions.flow.sendAll')}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                size="l"
                disabled={current === 0}
                onClick={onPrev}
              >
                {t('questions.flow.prev')}
              </Button>
              {sendsHere ? (
                <Button type="button" size="l" disabled={!canSend || sending} onClick={onSend}>
                  {sending ? t('questions.flow.sending') : t('questions.flow.send')}
                </Button>
              ) : (
                <Button type="button" size="l" onClick={onNext}>
                  {t('questions.flow.next')}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </Drawer>
  );
}
