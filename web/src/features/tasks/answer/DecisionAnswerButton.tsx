import { CircleHelpIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import './decision-answer.css';

/** The selector of the card's answer button, for the dialog to give the focus back to. */
export function decisionAnswerButtonSelector(taskId: number): string {
  return `[data-decision-answer][data-task-id="${taskId}"]`;
}

export interface DecisionAnswerButtonProps {
  onClick: () => void;
  taskId: number;
}

/** The only control a card with a decision request shows; it opens the list of messages at its question. */
export function DecisionAnswerButton({ onClick, taskId }: DecisionAnswerButtonProps) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      className="decision-answer-button"
      data-decision-answer=""
      data-task-id={taskId}
      onClick={onClick}
    >
      <CircleHelpIcon aria-hidden="true" />
      {t('answer.open')}
    </Button>
  );
}
