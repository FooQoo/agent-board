import { useCallback, useMemo, useRef, useState } from 'react';
import { answerRequest } from '../../api/edit';
import type {
  AnswerFormKey,
  AnswerFormState,
  AnswerFormStateStore,
  AnswerResult,
  AnswerWriter,
} from './answer';
import type { TaskSummary, ProjectId } from '../../../../shared/api/contracts';

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

const hasUnsentInput = (state: AnswerFormState | undefined) =>
  state !== undefined && (state.choiceId !== null || state.text !== '');

/**
 * PC answer drafts and post-save snapshots belong to a project/card/request tuple.
 * A draft survives closing the answer; the lease that blocks a project switch is held
 * only while the answer is open with input, or while a send is in flight.
 */
export function useTaskAnswers(
  onLeaseChange: AnswerLeaseChange,
  write: AnswerWriter = answerRequest,
) {
  const entries = useRef(new Map<AnswerFormKey, Entry>());
  const saved = useRef(new Map<string, SavedAnswer>());
  const staleRequests = useRef(new Set<AnswerFormKey>());
  const openTasks = useRef(new Set<string>());
  const leases = useRef(new Map<string, { key: AnswerFormKey; projectId: ProjectId }>());
  const [, setRevision] = useState(0);
  const notify = useCallback((key?: AnswerFormKey) => {
    if (key)
      entries.current.get(key)?.listeners.forEach((listener) => {
        listener();
      });
    setRevision((value) => value + 1);
  }, []);

  /** Holds exactly one lease per task: open with input, or sending (open or not). */
  const syncLease = useCallback(
    (projectId: ProjectId, taskId: number) => {
      const prefix = taskPrefix(projectId, taskId);
      const taskEntries = [...entries.current.entries()].filter(([key]) => key.startsWith(prefix));
      const sending = taskEntries.find(([, entry]) => entry.state.phase === 'sending');
      const withInput = taskEntries.find(([, entry]) => hasUnsentInput(entry.state));
      const wanted =
        sending?.[0] ?? (openTasks.current.has(prefix) ? (withInput?.[0] ?? null) : null);
      const held = leases.current.get(prefix);
      if (held?.key === wanted) return;
      if (held) {
        leases.current.delete(prefix);
        onLeaseChange(held.key, held.projectId, false);
      }
      if (wanted) {
        leases.current.set(prefix, { key: wanted, projectId });
        onLeaseChange(wanted, projectId, true);
      }
    },
    [onLeaseChange],
  );

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
          // The user answered the new question: the carried-over older drafts are spent.
          const prefix = taskPrefix(projectId, Number(taskIdText));
          for (const olderKey of [...entries.current.keys()]) {
            if (olderKey !== key && olderKey.startsWith(prefix)) entries.current.delete(olderKey);
          }
        }
        syncLease(projectId, Number(taskIdText));
        notify(key);
      },
    }),
    [notify, syncLease],
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
      for (const key of [...entries.current.keys()]) {
        if (key.startsWith(prefix)) {
          staleRequests.current.add(key);
          entries.current.delete(key);
        }
      }
      syncLease(projectId, taskId);
      const receipt = saved.current.get(`${projectId}:${taskId}`);
      if (receipt) staleRequests.current.add(keyOf(projectId, taskId, receipt.requestId));
      saved.current.delete(`${projectId}:${taskId}`);
      notify();
    },
    [notify, syncLease],
  );

  const reconcileTasks = useCallback(
    (projectId: ProjectId, tasks: readonly TaskSummary[]) => {
      for (const task of tasks) {
        if (task.taskStatus === 'done') clearTask(projectId, task.id);
      }
    },
    [clearTask],
  );

  const setAnswerOpen = useCallback(
    (projectId: ProjectId, taskId: number, open: boolean) => {
      const prefix = taskPrefix(projectId, taskId);
      if (open) openTasks.current.add(prefix);
      else openTasks.current.delete(prefix);
      syncLease(projectId, taskId);
    },
    [syncLease],
  );

  const hasDraft = useCallback((projectId: ProjectId, taskId: number) => {
    const prefix = taskPrefix(projectId, taskId);
    return [...entries.current.entries()].some(
      ([key, entry]) => key.startsWith(prefix) && hasInput(entry.state),
    );
  }, []);

  const hasAnyDraft = useCallback(
    () => [...entries.current.values()].some((entry) => hasInput(entry.state)),
    [],
  );

  const withSavedAnswers = useCallback(
    (projectId: ProjectId, tasks: readonly TaskSummary[], syncedAt: Date | null) => {
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
    /** Tells the controller whether the answer for a task is open (its lease follows). */
    setAnswerOpen,
    /** True while any request of the task has unsent input, open or closed. */
    hasDraft,
    /** True while any task has unsent input; a build reload waits for it to clear. */
    hasAnyDraft,
  };
}
