import { CircleAlertIcon, ListChecksIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Surface } from '@/shared/ui/surface/Surface';
import { AssigneeLabel } from '../assignee/AssigneeLabel';
import { type Plan, planTitle } from './model/plan';
import './plan-review.css';

export interface PlanReviewProps {
  kind: 'dialog' | 'sheet';
  plan: Plan;
  /** The goal of a new epic, already rendered from the epic's document; `null` while it has none to show. */
  goal?: ReactNode;
  /** The start is on its way: both buttons wait. */
  starting?: boolean;
  /** What the last start answered, shown above the buttons. */
  error?: string | null;
  onClose: () => void;
  onStart: () => void;
  /** A question's button was pressed. The question's own screen is wired by the caller. */
  onOpenQuestion: (questionId: string) => void;
}

/**
 * The review of an approval: the goal, the tasks that will start, and the questions that still
 * block it. A single task is not numbered. The original request is not linked, so it is not shown.
 */
export function PlanReview({
  kind,
  plan,
  goal,
  starting = false,
  error = null,
  onClose,
  onStart,
  onOpenQuestion,
}: PlanReviewProps) {
  const { t } = useTranslation();
  const blocked = plan.questions.length > 0;
  const single = plan.tasks.length === 1;
  const scope =
    plan.kind === 'new'
      ? 'plan.scopeNew'
      : plan.kind === 'single'
        ? 'plan.scopeSingle'
        : 'plan.scopeAdded';
  const questionsTitle = t('plan.questionsTitle', { count: plan.questions.length });
  const footer = (
    <>
      {(blocked || error) && (
        <p className="plan-review__reason" role="note">
          <CircleAlertIcon aria-hidden="true" />
          {error ?? t('plan.startDisabled')}
        </p>
      )}
      <div className="plan-review__buttons">
        <Button type="button" variant="outline" disabled={starting} onClick={onClose}>
          {t('plan.later')}
        </Button>
        <Button type="button" disabled={blocked || starting} onClick={onStart}>
          {starting ? t('plan.starting') : t('plan.start')}
        </Button>
      </div>
    </>
  );
  return (
    <Surface
      kind={kind}
      title={t('plan.reviewTitle')}
      closeLabel={t('plan.close')}
      identity={t('plan.identity')}
      onClose={onClose}
      footer={footer}
      className="plan-review-surface"
    >
      <div className="plan-review">
        <header className="plan-review__head">
          <h3 className="plan-review__title">{planTitle(plan)}</h3>
          <p className="plan-review__scope">{t(scope)}</p>
        </header>
        {blocked && (
          <section className="plan-review__warn" aria-label={questionsTitle}>
            <h4>
              <CircleAlertIcon aria-hidden="true" />
              {questionsTitle}
            </h4>
            <p>{t('plan.questionsBody')}</p>
            <ul>
              {plan.questions.map((question) => (
                <li key={question.id}>
                  <span className="plan-review__q">
                    <span className="plan-review__id">{question.id}</span>
                    {question.title}
                  </span>
                  <Button
                    type="button"
                    size="s"
                    variant="outline"
                    onClick={() => onOpenQuestion(question.id)}
                  >
                    {t('plan.answer')}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {plan.kind === 'new' && (
          <section className="plan-review__section">
            <h4>{t('plan.goal')}</h4>
            <div className="plan-review__goal">
              {goal ?? <p className="plan-review__goal-state">{t('plan.goalEmpty')}</p>}
            </div>
          </section>
        )}
        <section className="plan-review__section">
          <h4>{single ? t('plan.taskSingle') : t('plan.tasks')}</h4>
          <ol
            className={
              single ? 'plan-review__tasks plan-review__tasks--single' : 'plan-review__tasks'
            }
          >
            {plan.tasks.map((task, index) => (
              <li key={task.id}>
                {!single && <span className="plan-review__no">{index + 1}</span>}
                <span className="plan-review__name">
                  <span className="plan-review__id">#{task.id}</span>
                  {task.title}
                </span>
                <span className="plan-review__owner">
                  <AssigneeLabel assignee={task.assignee} />
                  {task.assignee === 'ai' ? t('plan.ownerAi') : t('plan.ownerHuman')}
                </span>
                <span className="plan-review__ac">
                  <ListChecksIcon aria-hidden="true" />
                  {t('plan.acceptance', { count: task.acceptance })}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </Surface>
  );
}
