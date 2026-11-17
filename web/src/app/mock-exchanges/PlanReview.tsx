import { CircleAlertIcon, ListChecksIcon } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { AssigneeLabel } from '../../features/tasks/assignee/AssigneeLabel';
import type { MockExchange, Plan } from './data';
import { Surface } from './Surface';
import { useMockText } from './text';
import './exchanges-mock.css';

/**
 * The review of an approval: the goal, the tasks that will start in order, and the questions that
 * still block it. The original request is not linked, so it is not shown.
 */
export function PlanReview({
  kind,
  plan,
  openQuestions,
  onClose,
  onAnswer,
}: {
  kind: 'dialog' | 'sheet';
  plan: Plan;
  /** The unanswered questions that name this plan's epic or tasks. */
  openQuestions: MockExchange[];
  onClose: () => void;
  onAnswer: (question: MockExchange) => void;
}) {
  const m = useMockText();
  const blocked = openQuestions.length > 0;
  const title =
    plan.kind === 'new'
      ? `${plan.epicId} ${plan.epicName}`
      : plan.kind === 'single'
        ? (plan.tasks[0]?.title ?? '')
        : m.planAdded(plan.epicId, plan.tasks.length);
  const scope =
    plan.kind === 'new'
      ? m.reviewScopeNew
      : plan.kind === 'single'
        ? m.reviewScopeSingle
        : m.reviewScopeAdded;
  const footer = (
    <>
      {blocked && (
        <p className="xreview__reason" role="note">
          <CircleAlertIcon aria-hidden="true" />
          {m.reviewStartDisabled}
        </p>
      )}
      <div className="xreview__buttons">
        <Button type="button" variant="outline" onClick={onClose}>
          {m.reviewLater}
        </Button>
        <Button type="button" disabled={blocked} onClick={onClose}>
          {m.reviewStart}
        </Button>
      </div>
    </>
  );
  return (
    <Surface
      kind={kind}
      title={m.reviewTitle}
      identity={m.typeApproval}
      onClose={onClose}
      footer={footer}
      className="xreview-surface"
    >
      <div className="xreview">
        <header className="xreview__head">
          <h3 className="xreview__title">{title}</h3>
          <p className="xreview__scope">{scope}</p>
        </header>
        {blocked && (
          <section
            className="xreview__warn"
            aria-label={m.reviewQuestionsTitle(openQuestions.length)}
          >
            <h4>
              <CircleAlertIcon aria-hidden="true" />
              {m.reviewQuestionsTitle(openQuestions.length)}
            </h4>
            <p>{m.reviewQuestionsBody}</p>
            <ul>
              {openQuestions.map((question) => (
                <li key={question.id}>
                  <span className="xreview__q">
                    <span className="xrow__id">{question.id}</span>
                    {question.title}
                  </span>
                  <Button
                    type="button"
                    size="s"
                    variant="outline"
                    onClick={() => onAnswer(question)}
                  >
                    {m.reviewAnswer}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {plan.kind === 'new' && (
          <section className="xreview__section">
            <h4>{m.reviewGoal}</h4>
            <div className="xreview__goal">
              {plan.goal.split('\n\n').map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          </section>
        )}
        <section className="xreview__section">
          <h4>{plan.tasks.length === 1 ? m.reviewTaskSingle : m.reviewTasks}</h4>
          <ol className="xreview__tasks">
            {plan.tasks.map((task, index) => (
              <li key={task.id}>
                <span className="xreview__no">{index + 1}</span>
                <span className="xreview__name">
                  <span className="xrow__id">#{task.id}</span>
                  {task.title}
                </span>
                <span className="xreview__owner">
                  <AssigneeLabel assignee={task.assignee} />
                  {task.assignee === 'ai' ? m.reviewOwnerAi : m.reviewOwnerHuman}
                </span>
                <span className="xreview__ac">
                  <ListChecksIcon aria-hidden="true" />
                  {m.reviewAcceptance(task.acceptance)}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </Surface>
  );
}
