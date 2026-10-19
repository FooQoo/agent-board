import { useCallback, useMemo, useRef, useState } from 'react';
import type { AnswerFormKey, AnswerWriter } from '../../../features/tasks/answer/model/answer';
import type { MonitorAnswerController } from '../contracts';
import { MonitorAnswerDrafts } from './MonitorAnswerDrafts';

export interface UseMonitorInteractionsOptions {
  writeAnswer?: AnswerWriter;
}

const defaultWriter: AnswerWriter = async () => {
  throw new Error('Monitor answer writer is not connected.');
};

/** Composes React updates with the monitor's request-keyed draft and answer state. */
export function useMonitorInteractions({
  writeAnswer = defaultWriter,
}: UseMonitorInteractionsOptions = {}): MonitorAnswerController {
  const [, setRevision] = useState(0);
  const drafts = useRef<MonitorAnswerDrafts | null>(null);
  const notify = useCallback((key?: AnswerFormKey) => {
    if (key) drafts.current?.notifyKey(key);
    setRevision((value) => value + 1);
  }, []);
  if (drafts.current === null) drafts.current = new MonitorAnswerDrafts(notify);
  const state = drafts.current;

  return useMemo<MonitorAnswerController>(
    () => ({
      writeAnswer,
      stateStore: state.stateStore,
      operationsFor: (projectId, taskId, requestId) =>
        state.operationsFor(projectId, taskId, requestId),
      onAnswered: (item, requestId, result) => state.onAnswered(item, requestId, result),
      markRequestStale: (projectId, taskId, requestId) =>
        state.markRequestStale(projectId, taskId, requestId),
      orphanDrafts: (tasks) => state.orphanDrafts(tasks),
      clearOrphanDraft: (key) => state.clearOrphanDraft(key),
      reconcileTasks: (tasks) => state.reconcileTasks(tasks),
      tasksWithSavedAnswers: (tasks, snapshotIsFresh) =>
        state.tasksWithSavedAnswers(tasks, snapshotIsFresh),
      wasAnswered: (projectId, taskId, requestId) =>
        state.wasAnswered(projectId, taskId, requestId),
      locked: state.locked,
    }),
    [state, writeAnswer, state.locked],
  );
}
