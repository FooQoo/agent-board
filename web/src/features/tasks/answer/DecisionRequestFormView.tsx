import { type FormEventHandler, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDownIcon, CircleAlertIcon, InfoIcon, LoaderIcon, PauseIcon } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Label } from '@/shared/ui/label';
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group';
import { Textarea } from '@/shared/ui/textarea';
import type { Task } from '../../../shared/api/contracts';
import type { DecisionRequestFormModel } from './useDecisionRequestForm';
import { useQuestionClamp } from './useQuestionClamp';

export function DecisionRequestFormView({
  question,
  choices,
  model,
  onChoiceChange,
  onTextChange,
  onExpandQuestion,
  onClear,
  onSubmit,
}: {
  question: string | null;
  choices: Task['pendingChoices'];
  model: DecisionRequestFormModel;
  onChoiceChange: (choiceId: string | null) => void;
  onTextChange: (text: string) => void;
  onExpandQuestion: () => void;
  onClear: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
}) {
  const { t } = useTranslation();
  const textareaId = useId();
  const messageId = useId();
  const { ref: reasonRef, cut } = useQuestionClamp(question, !model.questionExpanded);

  return (
    <section className="detail__request" aria-label={t('request.title')}>
      <p className="detail__banner-head">
        <PauseIcon aria-hidden="true" />
        <span>{t('request.title')}</span>
      </p>
      {question && (
        <>
          <p
            ref={reasonRef}
            className={`detail__reason${model.questionExpanded ? '' : ' detail__reason--clamped'}`}
          >
            {question}
          </p>
          {!model.questionExpanded && cut && (
            <button type="button" className="detail__more" onClick={onExpandQuestion}>
              {t('request.showMore')}
              <ChevronDownIcon aria-hidden="true" />
            </button>
          )}
        </>
      )}
      <form className="detail__answer" onSubmit={onSubmit} aria-describedby={messageId}>
        <RadioGroup
          className="detail__choices"
          aria-label={t('request.choices')}
          value={model.choiceId ?? ''}
          disabled={model.disabled}
          onValueChange={(value) => onChoiceChange(value === '' ? null : value)}
        >
          {choices.map((choice) => (
            <div className="detail__choice" key={choice.id}>
              <RadioGroupItem value={choice.id} id={`${textareaId}-${choice.id}`} />
              <Label htmlFor={`${textareaId}-${choice.id}`} className="detail__choice-label">
                {choice.label}
              </Label>
            </div>
          ))}
        </RadioGroup>
        <p className="detail__guide">{t('request.guideChoice')}</p>
        <Label htmlFor={textareaId} className="visually-hidden">
          {t('request.label')}
        </Label>
        <Textarea
          id={textareaId}
          className="detail__answer-input"
          value={model.text}
          placeholder={t('request.placeholder')}
          disabled={model.disabled}
          aria-invalid={model.message !== null || model.tooLong}
          onChange={(event) => onTextChange(event.target.value)}
        />
        <div id={messageId}>
          {model.message !== null ? (
            <p className="detail__error detail__error--icon" role="alert">
              <CircleAlertIcon aria-hidden="true" />
              {model.message}
            </p>
          ) : (
            <p className="detail__hint">
              <InfoIcon aria-hidden="true" />
              {t('request.saveHint')}
            </p>
          )}
        </div>
        <div className="detail__answer-actions">
          <Button
            type="button"
            variant="ghost"
            size="s"
            className="detail-btn detail-btn--sm detail-btn--quiet"
            disabled={model.disabled}
            onClick={onClear}
          >
            {t('request.cancel')}
          </Button>
          <Button
            type="submit"
            size="s"
            className="detail-btn detail-btn--sm"
            disabled={!model.sendable}
          >
            {model.phase === 'sending' ? (
              <>
                <LoaderIcon aria-hidden="true" />
                {t('request.sending')}
              </>
            ) : model.phase === 'failed' ? (
              t('request.retry')
            ) : (
              t('request.send')
            )}
          </Button>
        </div>
      </form>
    </section>
  );
}
