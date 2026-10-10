import { ChevronDownIcon, CircleAlertIcon, InfoIcon, LoaderIcon, PauseIcon } from 'lucide-react';
import { type FormEvent, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { type AnswerInput, WriteError, answerRequest, problemOf } from '../../api';
import type { OperationControls } from '../../lib/projectSession';
import type { Card, ProjectId } from '../../types';

const MAX_ANSWER = 2000;

/** True while the question is cut by its line limit (measured, so it follows the column width). */
function useCut(ref: React.RefObject<HTMLElement | null>, text: string | null, active: boolean) {
  const [cut, setCut] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `text` changes what is measured.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!active || element === null) return;
    const measure = () => setCut(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, text, active]);
  return cut;
}

/**
 * The decision request of a pending card: the question, the single choice, the free text and Send, in
 * that order. The form is open from the start, empty. A send is for the request the form was opened for;
 * when the pending request changes, the form moves to the latest request and the old choice is dropped.
 */
export function DecisionRequest({
  projectId,
  card,
  operations,
  onChanged,
  onAnswered,
}: {
  projectId: ProjectId;
  card: Card;
  operations: OperationControls;
  /** An answer was saved (or found stale): the board should be fetched again. */
  onChanged?: () => void;
  /** An answer was saved. The panel tells the person that the work resumes. */
  onAnswered?: () => void;
}) {
  const { t } = useTranslation();
  const requestId = card.pendingRequestId;
  const choices = card.pendingChoices;
  const [expanded, setExpanded] = useState(false);
  // The request the form is written for. It follows the card when the card gets a new request.
  const [baseId, setBaseId] = useState<string | null>(requestId);
  const [choiceId, setChoiceId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<'editing' | 'sending' | 'failed'>('editing');
  const [failure, setFailure] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const reasonRef = useRef<HTMLParagraphElement>(null);
  const sending = useRef(false);
  const mounted = useRef(true);
  const operationsRef = useRef(operations);
  operationsRef.current = operations;
  const operationId = useRef<number | null>(null);
  const textareaId = useId();
  const messageId = useId();

  const cut = useCut(reasonRef, card.pendingReason, !expanded);
  const stale = requestId !== baseId;
  const hasText = text.trim() !== '';
  const tooLong = [...text].length > MAX_ANSWER;
  const dirty = choiceId !== null || text !== '';
  const sendable = !stale && (choiceId !== null || hasText) && !tooLong && phase !== 'sending';

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A request that changed under the form: keep the typed text, drop a choice the new request does not have.
  useEffect(() => {
    if (!stale) return;
    setBaseId(requestId);
    setChoiceId((current) => (choices.some((c) => c.id === current) ? current : null));
    setPhase('editing');
    setFailure(null);
    setChanged(true);
  }, [stale, requestId, choices]);

  // Typed input or a chosen option holds the project in place until it is sent or cleared.
  useEffect(() => {
    if (!dirty) return;
    const id = operationsRef.current.begin('answer', projectId);
    operationId.current = id;
    return () => {
      operationsRef.current.end(id);
      operationId.current = null;
    };
  }, [dirty, projectId]);

  const clear = () => {
    setChoiceId(null);
    setText('');
    setFailure(null);
    setChanged(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!sendable || sending.current || baseId === null) return;
    sending.current = true;
    setPhase('sending');
    setFailure(null);
    setChanged(false);
    const input: AnswerInput = { requestId: baseId };
    if (choiceId !== null) input.choiceId = choiceId;
    if (hasText) input.text = text;
    const id = operationId.current;
    if (id !== null) operations.saveStarted(id);
    try {
      await answerRequest(projectId, card.id, input);
      sending.current = false;
      if (!mounted.current) return;
      clear();
      setPhase('editing');
      onAnswered?.();
      onChanged?.();
    } catch (error) {
      sending.current = false;
      if (id !== null) operations.saveFailed(id);
      if (!mounted.current) return;
      if (
        error instanceof WriteError &&
        (error.code === 'request_changed' || error.status === 404)
      ) {
        setPhase('editing');
        setChanged(true);
        onChanged?.();
        return;
      }
      setPhase('failed');
      const problem = problemOf(error);
      setFailure(
        problem === null
          ? t('detail.saveError')
          : problem.field === ''
            ? t('detail.problemNoField', { file: problem.file, reason: problem.reason })
            : t('detail.problem', {
                file: problem.file,
                field: problem.field,
                reason: problem.reason,
              }),
      );
    }
  };

  const message = changed ? t('request.changed') : failure;

  return (
    <section className="detail__request" aria-label={t('request.title')}>
      <p className="detail__banner-head">
        <PauseIcon aria-hidden="true" />
        <span>{t('request.title')}</span>
      </p>
      {card.pendingReason && (
        <>
          <p
            ref={reasonRef}
            className={`detail__reason${expanded ? '' : ' detail__reason--clamped'}`}
          >
            {card.pendingReason}
          </p>
          {!expanded && cut && (
            <button type="button" className="detail__more" onClick={() => setExpanded(true)}>
              {t('request.showMore')}
              <ChevronDownIcon aria-hidden="true" />
            </button>
          )}
        </>
      )}
      <form className="detail__answer" onSubmit={submit} aria-describedby={messageId}>
        {choices.length > 0 && (
          <RadioGroup
            className="detail__choices"
            aria-label={t('request.choices')}
            value={choiceId ?? ''}
            disabled={phase === 'sending'}
            onValueChange={(value) => {
              setChoiceId(value === '' ? null : value);
              if (changed) setChanged(false);
            }}
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
        )}
        <p className="detail__guide">
          {choices.length > 0 ? t('request.guideChoice') : t('request.guideText')}
        </p>
        <Label htmlFor={textareaId} className="visually-hidden">
          {t('request.label')}
        </Label>
        <Textarea
          id={textareaId}
          className="detail__answer-input"
          value={text}
          placeholder={t('request.placeholder')}
          disabled={phase === 'sending'}
          aria-invalid={failure !== null || tooLong}
          onChange={(event) => {
            setText(event.target.value);
            if (changed) setChanged(false);
          }}
        />
        <div id={messageId}>
          {message !== null ? (
            <p className="detail__error detail__error--icon" role="alert">
              <CircleAlertIcon aria-hidden="true" />
              {message}
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
            className="detail-btn detail-btn--sm detail-btn--quiet"
            disabled={phase === 'sending'}
            onClick={clear}
          >
            {t('request.cancel')}
          </Button>
          <Button type="submit" className="detail-btn detail-btn--sm" disabled={!sendable}>
            {phase === 'sending' ? (
              <>
                <LoaderIcon aria-hidden="true" />
                {t('request.sending')}
              </>
            ) : phase === 'failed' ? (
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
