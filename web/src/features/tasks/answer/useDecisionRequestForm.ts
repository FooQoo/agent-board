import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  AnswerFormKey,
  AnswerFormState,
  AnswerFormStateStore,
  AnswerInput,
  AnswerResult,
  AnswerWriter,
} from './model/answer';
import { problemOf, WriteError } from '../../../shared/api/writeErrors';
import type { OperationControls } from '../../../shared/lib/operations/operations';
import type { TaskSummary, ProjectId } from '../../../shared/api/contracts';

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

export interface DecisionRequestFormModel {
  choiceId: string | null;
  text: string;
  questionExpanded: boolean;
  phase: AnswerFormState['phase'];
  message: string | null;
  tooLong: boolean;
  sendable: boolean;
  disabled: boolean;
}

/** What the answer dialog and sheet read; a superset of the older inline form's model. */
export interface DecisionAnswerModel extends DecisionRequestFormModel {
  /** True when a choice or a note is entered. */
  hasInput: boolean;
  /** `changed`: the question was replaced. `withdrawn`: it is gone or was answered elsewhere. */
  notice: 'changed' | 'withdrawn' | null;
  failure: string | null;
}

interface UseDecisionRequestFormOptions {
  projectId: ProjectId;
  task: TaskSummary;
  operations: OperationControls;
  writeAnswer: AnswerWriter;
  disabled: boolean;
  /** True when the task is no longer on the board; the last question stays readable. */
  missing?: boolean;
  stateStore?: AnswerFormStateStore;
  onChanged?: () => void;
  onAnswered?: (result: AnswerResult) => void;
  onRequestStale?: (requestId: string) => void;
}

export function useDecisionRequestForm({
  projectId,
  task,
  operations,
  writeAnswer,
  disabled,
  missing = false,
  stateStore,
  onChanged,
  onAnswered,
  onRequestStale,
}: UseDecisionRequestFormOptions) {
  const { t } = useTranslation();
  // A withdrawn question keeps the last request's key, so its input stays readable.
  const lastRequestId = useRef(task.pendingRequestId);
  if (task.pendingRequestId !== null) lastRequestId.current = task.pendingRequestId;
  const requestId = task.pendingRequestId ?? lastRequestId.current;
  // The request this form answered. Its going away is that answer, not a withdrawal: the sheet is
  // still sliding shut when the answered task replaces the card.
  const answeredHere = useRef<string | null>(null);
  const answered =
    task.pendingRequestId === null &&
    answeredHere.current !== null &&
    answeredHere.current === requestId;
  const withdrawn = missing || (task.pendingRequestId === null && !answered);
  const storeKey = `${projectId}:${task.id}:${requestId ?? ''}` as AnswerFormKey;
  const [state, setState] = useState(
    () => stateStore?.getSnapshot(storeKey) ?? initialState(requestId),
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const sending = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    if (!stateStore) return;
    const sync = () => {
      const next = stateStore.getSnapshot(storeKey);
      if (next) {
        stateRef.current = next;
        setState(next);
      }
    };
    return stateStore.subscribe(storeKey, sync);
  }, [stateStore, storeKey]);

  const update = useCallback(
    (transform: (current: AnswerFormState) => AnswerFormState) => {
      const next = transform(stateStore?.getSnapshot(storeKey) ?? stateRef.current);
      stateRef.current = next;
      setState(next);
      stateStore?.update(storeKey, () => next);
    },
    [stateStore, storeKey],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const stale = requestId !== state.baseRequestId;
  useEffect(() => {
    if (!stale) return;
    update((current) => ({
      ...current,
      baseRequestId: requestId,
      choiceId: null,
      phase: 'editing',
      failure: null,
      requestChanged: true,
    }));
  }, [stale, requestId, update]);

  const hasText = state.text.trim() !== '';
  const tooLong = [...state.text].length > MAX_ANSWER;
  const hasInput = state.choiceId !== null || state.text !== '';
  const sendable =
    !disabled &&
    !withdrawn &&
    !answered &&
    !stale &&
    !state.requestChanged &&
    (state.choiceId !== null || hasText) &&
    !tooLong &&
    state.phase !== 'sending';

  const clear = useCallback(() => {
    update((current) => ({
      ...current,
      choiceId: null,
      text: '',
      failure: null,
      requestChanged: false,
    }));
  }, [update]);

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const current = stateRef.current;
      if (!sendable || sending.current || current.baseRequestId === null) return;
      sending.current = true;
      update((value) => ({ ...value, phase: 'sending', failure: null, requestChanged: false }));
      const input: AnswerInput = { requestId: current.baseRequestId };
      if (current.choiceId !== null) input.choiceId = current.choiceId;
      if (current.text.trim() !== '') input.text = current.text;
      // The operation holds the board still only while the answer is on its way.
      const id = operations.begin('answer', projectId);
      operations.saveStarted(id);
      try {
        const result = await writeAnswer(projectId, task.id, input);
        sending.current = false;
        answeredHere.current = current.baseRequestId;
        operations.end(id);
        if (!mounted.current) return;
        clear();
        update((value) => ({ ...value, phase: 'editing' }));
        onAnswered?.(result);
        onChanged?.();
      } catch (error) {
        sending.current = false;
        operations.saveFailed(id);
        operations.end(id);
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
    },
    [
      clear,
      onAnswered,
      onChanged,
      onRequestStale,
      operations,
      projectId,
      sendable,
      t,
      task.id,
      update,
      writeAnswer,
    ],
  );

  const updateChoice = useCallback(
    (choiceId: string | null) => {
      update((current) => ({ ...current, choiceId, requestChanged: false }));
    },
    [update],
  );
  const updateText = useCallback(
    (text: string) => {
      update((current) => ({ ...current, text, requestChanged: false }));
    },
    [update],
  );
  const expandQuestion = useCallback(() => {
    update((current) => ({ ...current, questionExpanded: true }));
  }, [update]);

  return {
    model: {
      choiceId: state.choiceId,
      text: state.text,
      questionExpanded: state.questionExpanded,
      phase: state.phase,
      message: state.requestChanged ? t('request.changed') : state.failure,
      tooLong,
      sendable,
      disabled: disabled || withdrawn || answered || state.phase === 'sending',
      hasInput,
      notice: withdrawn ? 'withdrawn' : state.requestChanged ? 'changed' : null,
      failure: state.failure,
    } satisfies DecisionAnswerModel,
    updateChoice,
    updateText,
    expandQuestion,
    clear,
    submit,
  };
}
