import { ChevronDownIcon, CircleAlertIcon, InfoIcon, LoaderIcon, PauseIcon } from 'lucide-react';
import {
  type FormEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import type {
  AnswerFormKey,
  AnswerFormState,
  AnswerFormStateStore,
  AnswerInput,
  AnswerResult,
  AnswerWriter,
} from '../../lib/answer';
import { problemOf, WriteError } from '../../lib/writeErrors';
import type { OperationControls } from '../../lib/projectSession';
import type { Card, ProjectId } from '../../types';
import '../../styles/decision-request.css';

const MAX_ANSWER = 2000;
const EMPTY_STATE: AnswerFormState = {
  baseRequestId: null,
  choiceId: null,
  text: '',
  questionExpanded: false,
  phase: 'editing',
  failure: null,
  requestChanged: false,
};

function initialState(requestId: string | null): AnswerFormState {
  return { ...EMPTY_STATE, baseRequestId: requestId };
}

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

/** Shared answer form for the local board and the isolated mobile monitor. */
export function DecisionRequestForm({
  projectId,
  card,
  operations,
  writeAnswer,
  disabled = false,
  stateStore,
  onChanged,
  onAnswered,
  onRequestStale,
}: {
  projectId: ProjectId;
  card: Card;
  operations: OperationControls;
  writeAnswer: AnswerWriter;
  disabled?: boolean;
  stateStore?: AnswerFormStateStore;
  onChanged?: () => void;
  onAnswered?: (result: AnswerResult) => void;
  onRequestStale?: (requestId: string) => void;
}) {
  const { t } = useTranslation();
  const requestId = card.pendingRequestId;
  const choices = card.pendingChoices;
  const storeKey = `${projectId}:${card.id}:${requestId ?? ''}` as AnswerFormKey;
  const [localState, setLocalState] = useState(
    () => stateStore?.getSnapshot(storeKey) ?? initialState(requestId),
  );
  const stateRef = useRef(localState);
  stateRef.current = localState;
  useEffect(() => {
    if (!stateStore) return;
    const sync = () => {
      const next = stateStore.getSnapshot(storeKey);
      if (next) {
        stateRef.current = next;
        setLocalState(next);
      }
    };
    return stateStore.subscribe(storeKey, sync);
  }, [stateStore, storeKey]);

  const update = useCallback(
    (transform: (state: AnswerFormState) => AnswerFormState) => {
      const next = transform(stateStore?.getSnapshot(storeKey) ?? stateRef.current);
      stateRef.current = next;
      setLocalState(next);
      stateStore?.update(storeKey, () => next);
    },
    [stateStore, storeKey],
  );
  const reasonRef = useRef<HTMLParagraphElement>(null);
  const sending = useRef(false);
  const mounted = useRef(true);
  const operationsRef = useRef(operations);
  operationsRef.current = operations;
  const operationId = useRef<number | null>(null);
  const textareaId = useId();
  const messageId = useId();

  const cut = useCut(reasonRef, card.pendingReason, !localState.questionExpanded);
  const stale = requestId !== localState.baseRequestId;
  const hasText = localState.text.trim() !== '';
  const tooLong = [...localState.text].length > MAX_ANSWER;
  const dirty = localState.choiceId !== null || localState.text !== '';
  const sendable =
    !disabled &&
    !stale &&
    !localState.requestChanged &&
    (localState.choiceId !== null || hasText) &&
    !tooLong &&
    localState.phase !== 'sending';

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!stale) return;
    update((current) => ({
      ...current,
      baseRequestId: requestId,
      choiceId: choices.some((choice) => choice.id === current.choiceId) ? current.choiceId : null,
      phase: 'editing',
      failure: null,
      requestChanged: true,
    }));
  }, [stale, requestId, choices, update]);

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
    update((current) => ({
      ...current,
      choiceId: null,
      text: '',
      failure: null,
      requestChanged: false,
    }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const current = stateRef.current;
    if (!sendable || sending.current || current.baseRequestId === null) return;
    sending.current = true;
    update((value) => ({ ...value, phase: 'sending', failure: null, requestChanged: false }));
    const input: AnswerInput = { requestId: current.baseRequestId };
    if (current.choiceId !== null) input.choiceId = current.choiceId;
    if (hasText) input.text = current.text;
    const id = operationId.current;
    if (id !== null) operations.saveStarted(id);
    try {
      const result = await writeAnswer(projectId, card.id, input);
      sending.current = false;
      if (!mounted.current) return;
      clear();
      update((value) => ({ ...value, phase: 'editing' }));
      onAnswered?.(result);
      onChanged?.();
    } catch (error) {
      sending.current = false;
      if (id !== null) operations.saveFailed(id);
      if (!mounted.current) return;
      if (
        error instanceof WriteError &&
        (error.code === 'request_changed' || error.status === 404)
      ) {
        onRequestStale?.(current.baseRequestId);
        update((value) => ({ ...value, phase: 'editing', requestChanged: true }));
        onChanged?.();
        return;
      }
      const problem = problemOf(error);
      update((value) => ({
        ...value,
        phase: 'failed',
        failure:
          error instanceof WriteError && error.code === 'page_out_of_date'
            ? t('detail.pageOutOfDate')
            : problem === null
              ? t('detail.saveError')
              : problem.field === ''
                ? t('detail.problemNoField', { file: problem.file, reason: problem.reason })
                : t('detail.problem', {
                    file: problem.file,
                    field: problem.field,
                    reason: problem.reason,
                  }),
      }));
    }
  };

  const message = localState.requestChanged ? t('request.changed') : localState.failure;

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
            className={`detail__reason${localState.questionExpanded ? '' : ' detail__reason--clamped'}`}
          >
            {card.pendingReason}
          </p>
          {!localState.questionExpanded && cut && (
            <button
              type="button"
              className="detail__more"
              onClick={() => update((value) => ({ ...value, questionExpanded: true }))}
            >
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
            value={localState.choiceId ?? ''}
            disabled={disabled || localState.phase === 'sending'}
            onValueChange={(value) =>
              update((current) => ({
                ...current,
                choiceId: value === '' ? null : value,
                requestChanged: false,
              }))
            }
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
          value={localState.text}
          placeholder={t('request.placeholder')}
          disabled={disabled || localState.phase === 'sending'}
          aria-invalid={localState.failure !== null || tooLong}
          onChange={(event) =>
            update((current) => ({
              ...current,
              text: event.target.value,
              requestChanged: false,
            }))
          }
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
            disabled={disabled || localState.phase === 'sending'}
            onClick={clear}
          >
            {t('request.cancel')}
          </Button>
          <Button type="submit" className="detail-btn detail-btn--sm" disabled={!sendable}>
            {localState.phase === 'sending' ? (
              <>
                <LoaderIcon aria-hidden="true" />
                {t('request.sending')}
              </>
            ) : localState.phase === 'failed' ? (
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
