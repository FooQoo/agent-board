import { ClipboardListIcon, PencilLineIcon } from 'lucide-react';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { AssigneeLabel } from '../../features/tasks/assignee/AssigneeLabel';
import type { DraftTask, Plan } from './data';
import { useMockText } from './text';
import './exchanges-mock.css';

/**
 * The one card at the top of Todo that stands for a proposed plan. The AI-draft tasks of a draft epic
 * are not shown as cards of their own; this card opens the plan review instead.
 */
export function PlanCard({
  plan,
  openQuestionCount,
  onReview,
}: {
  plan: Plan;
  openQuestionCount: number;
  onReview: () => void;
}) {
  const m = useMockText();
  const title =
    plan.kind === 'new'
      ? `${plan.epicId} ${plan.epicName}`
      : m.planAdded(plan.epicId, plan.tasks.length);
  return (
    <div className="card__item" role="group">
      <div className="card xplan" data-kind={plan.kind}>
        <span className="card__top">
          <span className="xplan__label">
            <ClipboardListIcon aria-hidden="true" />
            {m.planCardLabel}
          </span>
        </span>
        <span className="card__title">{title}</span>
        <span className="xplan__meta">
          {plan.kind === 'new' && <span>{m.planNewEpic(plan.tasks.length)}</span>}
          {openQuestionCount > 0 && (
            <Badge variant="pending">{m.planOpenQuestions(openQuestionCount)}</Badge>
          )}
        </span>
        <Button type="button" size="s" className="xplan__action" onClick={onReview}>
          {m.planReview}
        </Button>
      </div>
    </div>
  );
}

/** A single AI-draft task that belongs to no draft epic: marked as a draft, with its own start action. */
export function DraftTaskCard({ draft, onReview }: { draft: DraftTask; onReview: () => void }) {
  const m = useMockText();
  const blocked = draft.questionIds.length > 0;
  return (
    <div className="card__item" role="group">
      <div className="card xdraft">
        <span className="card__top">
          <span className="card__id">#{draft.id}</span>
          <AssigneeLabel assignee={draft.assignee} />
          <span className="xdraft__mark">
            <PencilLineIcon aria-hidden="true" />
            {m.draftTask}
          </span>
        </span>
        <span className="card__title">{draft.title}</span>
        <span className="xdraft__foot">
          <Button
            type="button"
            size="s"
            variant="outline"
            disabled={blocked}
            aria-describedby={blocked ? `draft-${draft.id}-reason` : undefined}
            onClick={onReview}
          >
            {m.draftStart}
          </Button>
          {blocked && (
            <span id={`draft-${draft.id}-reason`} className="xdraft__reason">
              {m.draftStartHint}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
