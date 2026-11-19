import { useCallback, useEffect, useMemo, useRef, type Dispatch } from 'react';
import { parseAsString, useQueryState } from 'nuqs';
import { parseResultTarget, type ResultLinkTarget } from '../../features/tasks/results/resultLink';
import { findTask } from '../../features/tasks/model/board';
import type { BoardView } from './../data/assemble';
import type { SessionAction, SessionState } from './projectSession';

/**
 * The result link in the address: `?project=…&task=…&result=…` names a task and one of its results
 * beside the project. `selectRequested` is the project setter that also ends the link, because the
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
  const resultLink = useMemo(
    () =>
      parseResultTarget(
        new URLSearchParams({
          project: requested ?? '',
          task: taskParam ?? '',
          result: resultParam ?? '',
        }),
      ),
    [requested, taskParam, resultParam],
  );
  const clearResultLink = useCallback(() => {
    void setTaskParam(null, { history: 'replace' });
    void setResultParam(null, { history: 'replace' });
  }, [setTaskParam, setResultParam]);
  const selectRequested = useCallback(
    (projectId: string | null, options?: { history?: 'push' | 'replace' }) => {
      clearResultLink();
      return setRequested(projectId, options);
    },
    [setRequested, clearResultLink],
  );
  return { resultLink, clearResultLink, selectRequested };
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
    if (resultLink === null || boardData === null || viewMode !== 'board') return;
    if (activeProjectId !== resultLink.projectId) return;
    const key = `${activeProjectId}:${resultLink.taskId}:${resultLink.version}`;
    if (opened.current === key || findTask(boardData.tasks, resultLink.taskId) === null) return;
    opened.current = key;
    dispatch({ type: 'SELECT_CARD', id: resultLink.taskId });
  }, [resultLink, boardData, activeProjectId, viewMode, dispatch]);
}
