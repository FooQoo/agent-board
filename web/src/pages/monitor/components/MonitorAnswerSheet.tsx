import { DecisionAnswerSheet } from '../../../features/tasks/answer/DecisionAnswerSheet';
import type { BandQuestion } from '../../../features/tasks/answer/model/qa';
import { type AnswerStart, useAnswerFlow } from '../../../features/tasks/answer/useAnswerFlow';
import type { ProjectId } from '../../../shared/api/contracts';
import type { MonitorAnswerController, MonitorReadResolvers, MonitorTask } from '../contracts';
import { attachmentResolver } from './attachment-resolver';

export interface MonitorAnswerSheetProps {
  projectId: ProjectId;
  /** The open questions of the project. */
  questions: readonly BandQuestion[];
  /** Every task on the screen, for the title of a question's first card. */
  items: readonly MonitorTask[];
  start: AnswerStart;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  controller: MonitorAnswerController;
  resolvers: MonitorReadResolvers;
  /** The answers were saved; the list is read again at once. */
  onSent: () => void;
}

/**
 * The monitor's answer sheet: the same run through the questions as the PC dialog. It lives outside
 * the cards, so a card that moves does not close it. A `key` per opening starts it afresh.
 */
export default function MonitorAnswerSheet({
  projectId,
  questions,
  items,
  start,
  open,
  onOpenChange,
  controller,
  resolvers,
  onSent,
}: MonitorAnswerSheetProps) {
  const { goTo: _goTo, ...flow } = useAnswerFlow({
    projectId,
    questions,
    tasks: items.map((item) => item.task),
    book: controller.book,
    start,
    read: controller.read,
    write: controller.write,
    attachmentUrl: (taskId, id) =>
      attachmentResolver((attachmentId) =>
        resolvers.attachmentUrl(projectId, taskId, attachmentId),
      )(id),
    onSent: () => {
      onSent();
      onOpenChange(false);
    },
  });
  return <DecisionAnswerSheet {...flow} open={open} onOpenChange={onOpenChange} />;
}
