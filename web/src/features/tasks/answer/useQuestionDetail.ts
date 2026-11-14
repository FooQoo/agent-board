import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectId } from '@/shared/api/contracts';
import type { QuestionDetail, QuestionReader } from './model/qa';

export interface QuestionDetailState {
  /** The question as last read; it stays while it is read again, so the text does not flicker. */
  detail: QuestionDetail | null;
  state: 'loading' | 'ready' | 'failed';
  reload: () => void;
}

/**
 * Reads the question shown, and reads it again when `revision` changes (the question was answered
 * or withdrawn somewhere else). Each question read is kept, so going back shows it at once.
 */
export function useQuestionDetail(
  read: QuestionReader,
  projectId: ProjectId,
  questionId: string | null,
  revision: string,
  onRead?: (detail: QuestionDetail) => void,
): QuestionDetailState {
  const cache = useRef(new Map<string, QuestionDetail>());
  const [, setTick] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  useEffect(() => {
    if (questionId === null) return;
    let live = true;
    setFailed(null);
    // `revision` and `attempt` are the reasons to read again.
    void revision;
    void attempt;
    read(projectId, questionId).then(
      (detail) => {
        if (!live) return;
        cache.current.set(questionId, detail);
        setTick((value) => value + 1);
        onReadRef.current?.(detail);
      },
      () => {
        if (live) setFailed(questionId);
      },
    );
    return () => {
      live = false;
    };
  }, [read, projectId, questionId, revision, attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  const detail = questionId === null ? null : (cache.current.get(questionId) ?? null);
  return {
    detail,
    state: detail !== null ? 'ready' : failed === questionId ? 'failed' : 'loading',
    reload,
  };
}
