import { ClipboardListIcon, PencilLineIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { AssigneeLabel } from '../assignee/AssigneeLabel';
import { type Plan, planTitle } from './model/plan';
import './plan-card.css';

/**
 * The one card at the top of Todo that stands for an approval. The AI-draft tasks of the plan are
 * not shown as cards of their own; this card opens the plan review instead. A single AI-draft task
 * with no draft epic is a `DraftTaskCard`, and the epic's plans are a `PlanCard`.
 */
export function PlanCard({ plan, onReview }: { plan: Plan; onReview: () => void }) {
  const { t } = useTranslation();
  const title =
    plan.kind === 'new'
      ? planTitle(plan)
      : t('plan.added', { count: plan.tasks.length, epic: plan.epicId });
  return (
    <div className="card__item" role="group" aria-label={t('plan.cardLabel')}>
      <div className="card plan-card" data-kind={plan.kind}>
        <span className="card__top">
          <span className="plan-card__label">
            <ClipboardListIcon aria-hidden="true" />
            {t('plan.cardLabel')}
          </span>
        </span>
        <span className="card__title">{title}</span>
        <span className="plan-card__meta">
          {plan.kind === 'new' && <span>{t('plan.newEpic', { count: plan.tasks.length })}</span>}
          {plan.questions.length > 0 && (
            <Badge variant="pending">
              {t('plan.openQuestions', { count: plan.questions.length })}
            </Badge>
          )}
        </span>
        <Button type="button" size="s" className="plan-card__action" onClick={onReview}>
          {t('plan.review')}
        </Button>
      </div>
    </div>
  );
}

/** A single AI-draft task that belongs to no draft epic: marked as a draft, with its own start action. */
export function DraftTaskCard({ plan, onReview }: { plan: Plan; onReview: () => void }) {
  const { t } = useTranslation();
  const task = plan.tasks[0];
  const blocked = plan.questions.length > 0;
  const reasonId = `draft-${plan.id.replace('#', '')}-reason`;
  if (!task) return null;
  return (
    <div className="card__item" role="group">
      <div className="card draft-card">
        <span className="card__top">
          <span className="card__id">#{task.id}</span>
          <AssigneeLabel assignee={task.assignee} />
          <span className="draft-card__mark">
            <PencilLineIcon aria-hidden="true" />
            {t('plan.draftMark')}
          </span>
        </span>
        <span className="card__title">{task.title}</span>
        <span className="draft-card__foot">
          <Button
            type="button"
            size="s"
            variant="outline"
            disabled={blocked}
            aria-describedby={blocked ? reasonId : undefined}
            onClick={onReview}
          >
            {t('plan.draftStart')}
          </Button>
          {blocked && (
            <span id={reasonId} className="draft-card__reason">
              {t('plan.draftStartHint')}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

/** The card an approval gets in the Todo lane. */
export function PlanCardFor({ plan, onReview }: { plan: Plan; onReview: () => void }) {
  return plan.kind === 'single' ? (
    <DraftTaskCard plan={plan} onReview={onReview} />
  ) : (
    <PlanCard plan={plan} onReview={onReview} />
  );
}
