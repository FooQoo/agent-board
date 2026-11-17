import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectId } from '../../../shared/api/contracts';
import { projectPath } from '../../../shared/api/http';
import type { Message } from '../../../shared/data/api';
import { useEpicDetail } from '../../../shared/data/react';
import { DocumentBlocks } from '../detail/BodyDocumentView';
import { blockingQuestionIds, startPlan } from './api/start';
import { type Plan, planOfApproval } from './model/plan';
import { PlanReview } from './PlanReview';

export interface PlanReviewContainerProps {
  projectId: ProjectId;
  /** The project's plans: `BoardView.plans` on the board, `plansOfSummary(summary)` elsewhere. */
  plans: readonly Plan[];
  /** The approval to review: its message, or its ID (the epic's ID, or `#<task id>`). */
  approval: Pick<Message, 'id'> | string;
  /** A modal on the desktop, a bottom sheet on a phone. */
  kind: 'dialog' | 'sheet';
  onClose: () => void;
  /** A question's button was pressed. The caller opens the question's own screen. */
  onOpenQuestion: (questionId: string) => void;
  /** The start was saved, or was refused because of a new question: the project should be read again. */
  onChanged?: () => void;
  /** How a plan is started; the server's start route unless a story or test gives another. */
  start?: (projectId: ProjectId, plan: Plan) => Promise<void>;
}

/** The goal of a new epic: its document, read from the epic's `EPIC.md`. */
function EpicGoal({ projectId, epicId }: { projectId: ProjectId; epicId: string }) {
  const { document } = useEpicDetail(projectId, epicId);
  const data = document.data;
  if (data === null || data.blocks.length === 0) return null;
  return (
    <DocumentBlocks
      document={data}
      arriving={document.state === 'loading'}
      attachmentUrl={(id) =>
        `${projectPath(projectId)}/epics/${encodeURIComponent(epicId)}/attachments/${encodeURIComponent(id)}`
      }
      scrollParent={null}
    />
  );
}

/**
 * The plan review of an approval, wired to the server: it reads the goal of a new epic, starts the
 * plan, and shows a refusal for an unanswered question. It closes by itself once the plan is gone.
 */
export function PlanReviewContainer({
  projectId,
  plans,
  approval,
  kind,
  onClose,
  onOpenQuestion,
  onChanged,
  start: startRoute = startPlan,
}: PlanReviewContainerProps) {
  const { t } = useTranslation();
  const plan = planOfApproval(plans, approval);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gone = plan === null;
  useEffect(() => {
    if (gone && !starting) onClose();
  }, [gone, starting, onClose]);
  const start = useCallback(
    async (target: Plan) => {
      setStarting(true);
      setError(null);
      try {
        await startRoute(projectId, target);
        onChanged?.();
        onClose();
      } catch (failure) {
        const questions = blockingQuestionIds(failure);
        setError(
          questions === null
            ? t('plan.startFailed')
            : t('plan.startBlocked', { questions: questions.join(', ') }),
        );
        if (questions !== null) onChanged?.();
      } finally {
        setStarting(false);
      }
    },
    [projectId, startRoute, onChanged, onClose, t],
  );
  if (plan === null) return null;
  return (
    <PlanReview
      kind={kind}
      plan={plan}
      goal={
        plan.kind === 'new' && plan.epicId !== null ? (
          <EpicGoal projectId={projectId} epicId={plan.epicId} />
        ) : null
      }
      starting={starting}
      error={error}
      onClose={onClose}
      onStart={() => void start(plan)}
      onOpenQuestion={onOpenQuestion}
    />
  );
}
