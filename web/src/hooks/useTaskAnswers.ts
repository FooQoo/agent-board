import { useCallback, useMemo, useRef, useState } from 'react';
import { answerRequest } from '../api';
import type {
  AnswerFormKey,
  AnswerFormState,
  AnswerFormStateStore,
  AnswerResult,
  AnswerWriter,
} from '../lib/answer';
import type { Task, ProjectId } from '../types';

interface Entry {
  state: AnswerFormState;
  listeners: Set<() => void>;
}

interface SavedAnswer {
  requestId: string;
  result: AnswerResult;
  baselineSync: number | null;
}

export type AnswerLeaseChange = (key: AnswerFormKey, projectId: ProjectId, active: boolean) => void;

export type TaskAnswerController = ReturnType<typeof useTaskAnswers>;

const emptyState = (requestId: string | null, requestChanged = false): AnswerFormState => ({
  baseRequestId: requestId,
  choiceId: null,
  text: '',
  questionExpanded: false,
  phase: 'editing',
  failure: null,
  requestChanged,
});

const taskPrefix = (projectId: ProjectId, taskId: number) => `${projectId}:${taskId}:`;

const keyOf = (projectId: ProjectId, taskId: number, requestId: string | null) =>
  `${projectId}:${taskId}:${requestId ?? ''}` as AnswerFormKey;

const hasInput = (state: AnswerFormState | undefined) =>
  state !== undefined &&
  (state.choiceId !== null || state.text !== '' || state.phase === 'sending');

/** PC answer drafts and post-save snapshots belong to a project/card/request tuple. */
export function useTaskAnswers(
  onLeaseChange: AnswerLeaseChange,
  write: AnswerWriter = answerRequest,
) {
  const entries = useRef(new Map<AnswerFormKey, Entry>());
  const saved = useRef(new Map<string, SavedAnswer>());
  const staleRequests = useRef(new Set<AnswerFormKey>());
  const [, setRevision] = useState(0);
  const notify = useCallback((key?: AnswerFormKey) => {
    if (key)
      entries.current.get(key)?.listeners.forEach((listener) => {
        listener();
      });
    setRevision((value) => value + 1);
  }, []);

  const stateStore = useMemo<AnswerFormStateStore>(
    () => ({
      getSnapshot(key) {
        const existing = entries.current.get(key);
        if (existing) return existing.state;
        const [projectId, taskIdText, ...requestParts] = key.split(':');
        const prefix = taskPrefix(projectId ?? '', Number(taskIdText));
        const requestId = requestParts.join(':') || null;
        const olderDraft = [...entries.current.entries()].find(
          ([otherKey, entry]) =>
            otherKey.startsWith(prefix) && otherKey !== key && hasInput(entry.state),
        )?.[1].state;
        const state = {
          ...emptyState(requestId, olderDraft !== undefined),
          text: olderDraft?.text ?? '',
        };
        entries.current.set(key, { state, listeners: new Set() });
        return state;
      },
      subscribe(key, listener) {
        const entry = entries.current.get(key);
        if (!entry) return () => {};
        entry.listeners.add(listener);
        return () => entry.listeners.delete(listener);
      },
      update(key, update) {
        const entry = entries.current.get(key);
        const previous = entry?.state ?? emptyState(null);
        const state = update(previous);
        entries.current.set(key, { state, listeners: entry?.listeners ?? new Set() });
        const [projectIdValue, taskIdText] = key.split(':');
        const projectId = projectIdValue as ProjectId;
        if (previous.requestChanged && !state.requestChanged) {
          const prefix = taskPrefix(projectId, Number(taskIdText));
          for (const olderKey of entries.current.keys()) {
            if (olderKey === key || !olderKey.startsWith(prefix)) continue;
            if (hasInput(entries.current.get(olderKey)?.state))
              onLeaseChange(olderKey, projectId, false);
            entries.current.delete(olderKey);
          }
          if (hasInput(state)) onLeaseChange(key, projectId, true);
        } else if (hasInput(previous) !== hasInput(state)) {
          onLeaseChange(key, projectId, hasInput(state));
        }
        notify(key);
      },
    }),
    [notify, onLeaseChange],
  );

  const onAnswered = useCallback(
    (
      projectId: ProjectId,
      taskId: number,
      requestId: string,
      result: AnswerResult,
      syncedAt: Date | null,
    ) => {
      saved.current.set(`${projectId}:${taskId}`, {
        requestId,
        result,
        baselineSync: syncedAt?.getTime() ?? null,
      });
      notify();
    },
    [notify],
  );

  const clearTask = useCallback(
    (projectId: ProjectId, taskId: number) => {
      const prefix = taskPrefix(projectId, taskId);
      for (const key of entries.current.keys()) {
        if (key.startsWith(prefix)) {
          if (hasInput(entries.current.get(key)?.state)) onLeaseChange(key, projectId, false);
          staleRequests.current.add(key);
          entries.current.delete(key);
        }
      }
      const receipt = saved.current.get(`${projectId}:${taskId}`);
      if (receipt) staleRequests.current.add(keyOf(projectId, taskId, receipt.requestId));
      saved.current.delete(`${projectId}:${taskId}`);
      notify();
    },
    [notify, onLeaseChange],
  );

  const reconcileTasks = useCallback(
    (projectId: ProjectId, tasks: readonly Task[]) => {
      for (const task of tasks) {
        if (task.taskStatus === 'done') clearTask(projectId, task.id);
      }
    },
    [clearTask],
  );

  const withSavedAnswers = useCallback(
    (projectId: ProjectId, tasks: readonly Task[], syncedAt: Date | null) => {
      const syncTime = syncedAt?.getTime() ?? null;
      const byId = new Map(tasks.map((task) => [task.id, task]));
      for (const [key, receipt] of saved.current) {
        if (!key.startsWith(`${projectId}:`)) continue;
        const taskId = Number(key.slice(projectId.length + 1));
        const current = byId.get(taskId);
        if (!current) continue;
        if (
          syncTime !== null &&
          (receipt.baselineSync === null || syncTime > receipt.baselineSync) &&
          current.pendingRequestId !== receipt.requestId
        )
          saved.current.delete(key);
      }
      return tasks.map((task) => {
        const receipt = saved.current.get(`${projectId}:${task.id}`);
        return receipt?.requestId === task.pendingRequestId ? receipt.result.task : task;
      });
    },
    [],
  );

  const wasAnswered = useCallback(
    (projectId: ProjectId, taskId: number, requestId: string | null) =>
      requestId !== null &&
      (saved.current.get(`${projectId}:${taskId}`)?.requestId === requestId ||
        staleRequests.current.has(keyOf(projectId, taskId, requestId))),
    [],
  );

  return {
    stateStore,
    writeAnswer: write,
    onAnswered,
    clearTask,
    reconcileTasks,
    withSavedAnswers,
    wasAnswered,
  };
}
