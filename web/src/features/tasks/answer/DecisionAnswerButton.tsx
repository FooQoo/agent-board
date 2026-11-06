import { CircleHelpIcon, PencilIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import './decision-answer.css';

/** The selector of the card's answer button, for the dialog to give the focus back to. */
export function decisionAnswerButtonSelector(taskId: number): string {
  return `[data-decision-answer][data-task-id="${taskId}"]`;
}

export interface DecisionAnswerButtonProps {
  /** An answer is already started: the button says so and takes the outline. */
  continuing: boolean;
  onClick: () => void;
  taskId: number;
}

/** The only control a card with a decision request shows; it opens the answer. */
export function DecisionAnswerButton({ continuing, onClick, taskId }: DecisionAnswerButtonProps) {
  const { t } = useTranslation();
  const Icon = continuing ? PencilIcon : CircleHelpIcon;
  return (
    <Button
      type="button"
      variant={continuing ? 'outline' : 'default'}
      className="decision-answer-button"
      data-decision-answer=""
      data-task-id={taskId}
      onClick={onClick}
    >
      <Icon aria-hidden="true" />
      {continuing ? t('answer.continue') : t('answer.open')}
    </Button>
  );
}
