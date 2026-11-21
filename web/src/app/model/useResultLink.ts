import { useCallback, useEffect, useMemo, useRef, type Dispatch } from 'react';
import { parseAsString, useQueryState } from 'nuqs';
import {
  linkKey,
  parseResultTarget,
  type ResultLinkTarget,
} from '../../features/tasks/results/resultLink';
import { findTask } from '../../features/tasks/model/board';
import type { BoardView } from './../data/assemble';
import type { SessionAction, SessionState } from './projectSession';

/**
 * The result link in the address: `?project=…&task=…&result=…` names a task and one of its results beside
 * the project, and `?project=…&task=…&tab=history` names a task and its history. `?project=…&task=…&question=Q-n` names
 * a task and one of its questions. `selectRequested` is the project setter that also ends the link, because the
 * link's task belongs to the project it named.
 */
export function useResultLink(
  requested: string | null,
  setRequested: (
    projectId: string | null,
    options?: { history?: 'push' | 'replace' },
  ) => Promise<unknown>,
) {
  const [taskParam, setTaskParam] = useQueryState('task', parseAsString);
  const [resultParam, setResultParam] = useQueryState('result', parseAsString);
  const [tabParam, setTabParam] = useQueryState('tab', parseAsString);
  const [questionParam, setQuestionParam] = useQueryState('question', parseAsString);
  // `?project=…&messages=summary` (the periodic summary notification) opens the messages on the Summary tab.
  const [messagesParam, setMessagesParam] = useQueryState('messages', parseAsString);
  const summaryLink = requested !== null && messagesParam === 'summary';
  const clearSummaryLink = useCallback(
    () => void setMessagesParam(null, { history: 'replace' }),
    [setMessagesParam],
  );
  const resultLink = useMemo(
    () =>
      parseResultTarget(
        new URLSearchParams({
          project: requested ?? '',
          task: taskParam ?? '',
          ...(resultParam === null ? {} : { result: resultParam }),
          ...(tabParam === null ? {} : { tab: tabParam }),
          ...(questionParam === null ? {} : { question: questionParam }),
        }),
      ),
    [requested, taskParam, resultParam, tabParam, questionParam],
  );
  const clearResultLink = useCallback(() => {
    void setTaskParam(null, { history: 'replace' });
    void setResultParam(null, { history: 'replace' });
    void setTabParam(null, { history: 'replace' });
    void setQuestionParam(null, { history: 'replace' });
    void setMessagesParam(null, { history: 'replace' });
  }, [setTaskParam, setResultParam, setTabParam, setQuestionParam, setMessagesParam]);
  const selectRequested = useCallback(
    (projectId: string | null, options?: { history?: 'push' | 'replace' }) => {
      clearResultLink();
      return setRequested(projectId, options);
    },
    [setRequested, clearResultLink],
  );
  const summary = useMemo(
    () => ({ requested: summaryLink, clear: clearSummaryLink }),
    [summaryLink, clearSummaryLink],
  );
  return { resultLink, clearResultLink, selectRequested, summary };
}

/** On the PC board the link's task is selected once, so the person can choose another card afterwards. */
export function useLinkedTaskSelection(
  resultLink: ResultLinkTarget | null,
  boardData: BoardView | null,
  session: SessionState,
  dispatch: Dispatch<SessionAction>,
) {
  const opened = useRef<string | null>(null);
  const { activeProjectId, viewMode } = session;
  useEffect(() => {
    if (resultLink === null) {
      // The link ended (the drawer was closed), so the same link can open the task again.
      opened.current = null;
      return;
    }
    if (boardData === null || viewMode !== 'board') return;
    if (activeProjectId !== resultLink.projectId) return;
    const key = `${activeProjectId}:${linkKey(resultLink)}`;
    if (opened.current === key || findTask(boardData.tasks, resultLink.taskId) === null) return;
    opened.current = key;
    dispatch({ type: 'SELECT_CARD', id: resultLink.taskId });
  }, [resultLink, boardData, activeProjectId, viewMode, dispatch]);
}
