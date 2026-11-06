import type { Task } from '@/shared/api/contracts';
import type { AttachmentResolver } from '@/shared/markdown/model';
import { DecisionAnswerFields } from './DecisionAnswerFields';
import { DecisionQuestion } from './DecisionQuestion';
import type { DecisionAnswerView } from './decisionAnswerView';
import './decision-answer.css';

export interface DecisionAnswerPanelProps {
  question: string | null;
  choices: Task['pendingChoices'];
  view: DecisionAnswerView;
  resolveAttachment?: AttachmentResolver;
  onChoiceChange: (choiceId: string | null) => void;
  onTextChange: (text: string) => void;
  onClear: () => void;
}

/**
 * The question and the answer field. In the dialog the question is on the left and scrolls by
 * itself while the answer stays; in the sheet, and in a narrow dialog, the two stack and scroll
 * together.
 */
export function DecisionAnswerPanel({
  question,
  choices,
  view,
  resolveAttachment,
  onChoiceChange,
  onTextChange,
  onClear,
}: DecisionAnswerPanelProps) {
  return (
    <div className="decision-panel">
      <div className="decision-panel__question">
        <DecisionQuestion question={question} resolveAttachment={resolveAttachment} />
      </div>
      <div className="decision-panel__answer">
        <DecisionAnswerFields
          choices={choices}
          view={view}
          onChoiceChange={onChoiceChange}
          onTextChange={onTextChange}
          onClear={onClear}
        />
      </div>
    </div>
  );
}
