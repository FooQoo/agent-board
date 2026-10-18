// biome-ignore lint/style/noExcessiveLinesPerFile: predates the 300-line limit; split it by responsibility rather than growing it.
import { useCallback, useMemo, useRef, useState } from 'react';
import type {
  AnswerFormKey,
  AnswerFormState,
  AnswerFormStateStore,
  AnswerResult,
  AnswerWriter,
} from '../../lib/answer';
import type { OperationControls } from '../../lib/projectSession';
import type { ProjectId } from '../../types';
import type { MonitorTask } from '../contracts';

interface Entry {
  state: AnswerFormState;
  listeners: Set<() => void>;
}

interface Lease {
  id: number;
  projectId: ProjectId;
  saving: boolean;
}

interface SavedAnswer {
  requestId: string;
  result: AnswerResult;
}

export interface UseMonitorInteractionsOptions {
  writeAnswer?: AnswerWriter;
}

export interface OrphanAnswerDraft {
  key: AnswerFormKey;
  projectName: string;
  taskId: number;
  text: string;
  choiceId: string | null;
}

export interface MonitorAnswerController {
  writeAnswer: AnswerWriter;
  stateStore: AnswerFormStateStore;
  operationsFor(projectId: ProjectId, taskId: number, requestId: string | null): OperationControls;
  onAnswered(item: MonitorTask, requestId: string, result: AnswerResult): void;
  markRequestStale(projectId: ProjectId, taskId: number, requestId: string): void;
  orphanDrafts(tasks: readonly MonitorTask[]): OrphanAnswerDraft[];
  clearOrphanDraft(key: AnswerFormKey): void;
  reconcileTasks(tasks: readonly MonitorTask[]): void;
  tasksWithSavedAnswers(tasks: readonly MonitorTask[], snapshotIsFresh: boolean): MonitorTask[];
  wasAnswered(projectId: ProjectId, taskId: number, requestId: string | null): boolean;
  locked: boolean;
}

const defaultWriter: AnswerWriter = async () => {
  throw new Error('Monitor answer writer is not connected.');
};

function formKey(projectId: ProjectId, taskId: number, requestId: string | null): AnswerFormKey {
  return `${projectId}:${taskId}:${requestId ?? ''}` as AnswerFormKey;
}

function taskPrefix(projectId: ProjectId, taskId: number): string {
  return `${projectId}:${taskId}:`;
}

function initialState(requestId: string | null, requestChanged = false): AnswerFormState {
  return {
    baseRequestId: requestId,
    choiceId: null,
    text: '',
    questionExpanded: false,
    phase: 'editing',
    failure: null,
    requestChanged,
  };
}

function hasInput(state: AnswerFormState | undefined): boolean {
  return (
    state !== undefined &&
    (state.choiceId !== null || state.text !== '' || state.phase === 'sending')
  );
}

/** Per-request draft and write leases shared by every monitor card instance across refreshes. */
export function useMonitorInteractions({
  writeAnswer = defaultWriter,
}: UseMonitorInteractionsOptions = {}): MonitorAnswerController {
  const entries = useRef(new Map<AnswerFormKey, Entry>());
  const leases = useRef(new Map<AnswerFormKey, Lease>());
  const saved = useRef(new Map<string, SavedAnswer>());
  const staleRequests = useRef(new Set<string>());
  const projectNames = useRef(new Map<ProjectId, string>());
  const nextOperationId = useRef(0);
  const [, setRevision] = useState(0);
  const notify = useCallback((key?: AnswerFormKey) => {
    if (key) {
      entries.current.get(key)?.listeners.forEach((listener) => {
        listener();
      });
    }
    setRevision((value) => value + 1);
  }, []);

  const stateStore = useMemo<AnswerFormStateStore>(
    () => ({
      getSnapshot(key) {
        const existing = entries.current.get(key);
        if (existing) return existing.state;
        const [projectId, taskIdText, ...requestParts] = key.split(':');
        const taskId = Number(taskIdText);
        const prefix = taskPrefix(projectId ?? '', taskId);
        const hasOlderDraft = [...entries.current.entries()].some(
          ([otherKey, entry]) =>
            otherKey.startsWith(prefix) && otherKey !== key && hasInput(entry.state),
        );
        const state = initialState(requestParts.join(':') || null, hasOlderDraft);
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
        const current = entries.current.get(key)?.state ?? initialState(null);
        const next = update(current);
        entries.current.set(key, {
          state: next,
          listeners: entries.current.get(key)?.listeners ?? new Set(),
        });
        if (current.requestChanged && !next.requestChanged) {
          const [projectId, taskIdText] = key.split(':');
          const prefix = taskPrefix(projectId ?? '', Number(taskIdText));
          for (const olderKey of entries.current.keys()) {
            if (olderKey !== key && olderKey.startsWith(prefix)) {
              entries.current.delete(olderKey);
              leases.current.delete(olderKey);
            }
          }
        }
        notify(key);
      },
    }),
    [notify],
  );

  const operationsFor = useCallback(
    (projectId: ProjectId, taskId: number, requestId: string | null): OperationControls => {
      const key = formKey(projectId, taskId, requestId);
      return {
        begin(_kind, operationProjectId) {
          const existing = leases.current.get(key);
          if (existing) return existing.id;
          const id = ++nextOperationId.current;
          leases.current.set(key, { id, projectId: operationProjectId, saving: false });
          notify();
          return id;
        },
        saveStarted(id) {
          const lease = leases.current.get(key);
          if (lease?.id === id) {
            lease.saving = true;
            notify();
          }
        },
        saveFailed(id) {
          const lease = leases.current.get(key);
          if (lease?.id === id) {
            lease.saving = false;
            notify();
          }
        },
        end(id) {
          const lease = leases.current.get(key);
          if (!lease || lease.id !== id) return;
          if (hasInput(entries.current.get(key)?.state)) return;
          leases.current.delete(key);
          notify();
        },
        taskRemoved(id, removedProjectId, removedTaskId) {
          if (id !== leases.current.get(key)?.id) return;
          if (removedProjectId === projectId && removedTaskId === taskId) {
            leases.current.delete(key);
            entries.current.delete(key);
            notify();
          }
        },
        isCurrent(id, operationProjectId) {
          const lease = leases.current.get(key);
          return lease?.id === id && lease.projectId === operationProjectId;
        },
      };
    },
    [notify],
  );

  const onAnswered = useCallback(
    (item: MonitorTask, requestId: string, result: AnswerResult) => {
      const requestKey = formKey(item.projectId, item.task.id, requestId);
      if (staleRequests.current.has(requestKey)) return;
      saved.current.set(`${item.projectId}:${item.task.id}`, { requestId, result });
      notify();
    },
    [notify],
  );

  const markRequestStale = useCallback(
    (projectId: ProjectId, taskId: number, requestId: string) => {
      staleRequests.current.add(formKey(projectId, taskId, requestId));
      notify();
    },
    [notify],
  );

  const orphanDrafts = useCallback((tasks: readonly MonitorTask[]) => {
    const byId = new Map(tasks.map((item) => [`${item.projectId}:${item.task.id}`, item]));
    const drafts: OrphanAnswerDraft[] = [];
    for (const [key, entry] of entries.current) {
      if (!hasInput(entry.state)) continue;
      const [projectId, taskIdText, ...requestParts] = key.split(':');
      const current = byId.get(`${projectId}:${taskIdText}`);
      if (current) projectNames.current.set(current.projectId, current.projectName);
      if (current?.task.taskStatus === 'done') continue;
      if (
        current?.task.pendingRequestId &&
        current.task.pendingRequestId !== requestParts.join(':')
      )
        continue;
      if (!current) {
        drafts.push({
          key,
          projectName: projectNames.current.get(projectId ?? '') ?? '—',
          taskId: Number(taskIdText),
          text: entry.state.text,
          choiceId: entry.state.choiceId,
        });
      } else if (current.task.pendingRequestId === null) {
        drafts.push({
          key,
          projectName: current.projectName,
          taskId: current.task.id,
          text: entry.state.text,
          choiceId: entry.state.choiceId,
        });
      }
    }
    return drafts;
  }, []);

  const clearOrphanDraft = useCallback(
    (key: AnswerFormKey) => {
      entries.current.delete(key);
      leases.current.delete(key);
      staleRequests.current.delete(key);
      notify();
    },
    [notify],
  );

  const reconcileTasks = useCallback(
    (tasks: readonly MonitorTask[]) => {
      const byId = new Map(tasks.map((item) => [`${item.projectId}:${item.task.id}`, item]));
      let changed = false;
      for (const key of entries.current.keys()) {
        const [projectId, taskIdText] = key.split(':');
        if (byId.get(`${projectId}:${taskIdText}`)?.task.taskStatus === 'done') {
          staleRequests.current.add(key);
          entries.current.delete(key);
          leases.current.delete(key);
          changed = true;
        }
      }
      for (const [key, receipt] of saved.current) {
        if (byId.get(key)?.task.taskStatus !== 'done') continue;
        const [projectId, taskIdText] = key.split(':');
        staleRequests.current.add(formKey(projectId ?? '', Number(taskIdText), receipt.requestId));
        saved.current.delete(key);
        changed = true;
      }
      if (changed) notify();
    },
    [notify],
  );

  const tasksWithSavedAnswers = useCallback(
    (tasks: readonly MonitorTask[], snapshotIsFresh: boolean) => {
      const byId = new Map(tasks.map((item) => [`${item.projectId}:${item.task.id}`, item]));
      for (const [key, receipt] of saved.current) {
        const current = byId.get(key);
        if (snapshotIsFresh && current && current.task.pendingRequestId !== receipt.requestId) {
          saved.current.delete(key);
        }
      }
      return tasks.map((item) => {
        const receipt = saved.current.get(`${item.projectId}:${item.task.id}`);
        if (!receipt || item.task.pendingRequestId !== receipt.requestId) return item;
        return { ...item, task: receipt.result.task };
      });
    },
    [],
  );

  const wasAnswered = useCallback(
    (projectId: ProjectId, taskId: number, requestId: string | null) => {
      return (
        requestId !== null &&
        (saved.current.get(`${projectId}:${taskId}`)?.requestId === requestId ||
          staleRequests.current.has(formKey(projectId, taskId, requestId)))
      );
    },
    [],
  );

  const locked =
    [...entries.current.values()].some(({ state }) => hasInput(state)) || leases.current.size > 0;
  return {
    writeAnswer,
    stateStore,
    operationsFor,
    onAnswered,
    markRequestStale,
    orphanDrafts,
    clearOrphanDraft,
    reconcileTasks,
    tasksWithSavedAnswers,
    wasAnswered,
    locked,
  };
}
