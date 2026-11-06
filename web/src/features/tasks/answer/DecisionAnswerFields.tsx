import { InfoIcon } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { Task } from '@/shared/api/contracts';
import { Label } from '@/shared/ui/label';
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group';
import { Textarea } from '@/shared/ui/textarea';
import type { DecisionAnswerView } from './decisionAnswerView';
import './decision-answer.css';

export interface DecisionAnswerFieldsProps {
  choices: Task['pendingChoices'];
  view: DecisionAnswerView;
  onChoiceChange: (choiceId: string | null) => void;
  onTextChange: (text: string) => void;
  onClear: () => void;
}

/** The right side: the options and the note, with the notice above them and the clear link below. */
export function DecisionAnswerFields({
  choices,
  view,
  onChoiceChange,
  onTextChange,
  onClear,
}: DecisionAnswerFieldsProps) {
  const { t } = useTranslation();
  const id = useId();
  const noticeText =
    view.notice === 'changed'
      ? t('answer.changed')
      : view.notice === 'withdrawn'
        ? t('answer.withdrawn')
        : null;
  return (
    <section
      className="decision-answer"
      aria-labelledby={`${id}-heading`}
      data-disabled={view.disabled ? 'true' : undefined}
    >
      <h3 className="decision-answer__heading" id={`${id}-heading`}>
        {t('answer.heading')}
      </h3>
      {noticeText !== null && (
        <p className="decision-answer__notice" role="status">
          <InfoIcon aria-hidden="true" />
          <span>{noticeText}</span>
        </p>
      )}
      {choices.length > 0 && (
        <RadioGroup
          className="decision-answer__choices"
          aria-labelledby={`${id}-heading`}
          value={view.choiceId ?? ''}
          disabled={view.disabled}
          onValueChange={(value) => onChoiceChange(value === '' ? null : value)}
        >
          {choices.map((choice) => (
            <label
              className="decision-answer__choice"
              key={choice.id}
              htmlFor={`${id}-${choice.id}`}
              data-checked={view.choiceId === choice.id ? 'true' : undefined}
            >
              <RadioGroupItem value={choice.id} id={`${id}-${choice.id}`} />
              <span>{choice.label}</span>
            </label>
          ))}
        </RadioGroup>
      )}
      <Label className="decision-answer__label" htmlFor={`${id}-note`}>
        {t('answer.note')}
      </Label>
      <Textarea
        id={`${id}-note`}
        className="decision-answer__note"
        value={view.text}
        placeholder={t('answer.notePlaceholder')}
        disabled={view.disabled}
        aria-invalid={view.tooLong}
        onChange={(event) => onTextChange(event.target.value)}
      />
      <div className="decision-answer__foot">
        {choices.length > 0 && <p className="decision-answer__guide">{t('answer.guide')}</p>}
        {view.hasInput && !view.disabled && (
          <button type="button" className="decision-answer__clear" onClick={onClear}>
            {t('answer.clear')}
          </button>
        )}
      </div>
    </section>
  );
}
