import type {
  AnswerFormKey,
  AnswerFormState,
  AnswerFormStateStore,
  AnswerResult,
} from '../../../features/tasks/answer/model/answer';
import type { ProjectId } from '../../../shared/api/contracts';
import type { OperationControls, OperationKind } from '../../../shared/lib/operations/operations';
import type { MonitorTask, OrphanAnswerDraft } from '../contracts';

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

/** Drafts and temporary receipts remain local to the monitor and keyed per request. */
export class MonitorAnswerDrafts {
  readonly entries = new Map<AnswerFormKey, Entry>();
  readonly leases = new Map<AnswerFormKey, Lease>();
  readonly saved = new Map<string, SavedAnswer>();
  readonly staleRequests = new Set<string>();
  readonly projectNames = new Map<ProjectId, string>();
  private nextOperationId = 0;

  constructor(private readonly notify: (key?: AnswerFormKey) => void) {}

  notifyKey(key: AnswerFormKey): void {
    this.entries.get(key)?.listeners.forEach((listener) => {
      listener();
    });
  }

  readonly stateStore: AnswerFormStateStore = {
    getSnapshot: (key) => {
      const existing = this.entries.get(key);
      if (existing) return existing.state;
      const [projectId, taskIdText, ...requestParts] = key.split(':');
      const prefix = taskPrefix(projectId ?? '', Number(taskIdText));
      const hasOlderDraft = [...this.entries.entries()].some(
        ([otherKey, entry]) =>
          otherKey.startsWith(prefix) && otherKey !== key && hasInput(entry.state),
      );
      const state = initialState(requestParts.join(':') || null, hasOlderDraft);
      this.entries.set(key, { state, listeners: new Set() });
      return state;
    },
    subscribe: (key, listener) => {
      const entry = this.entries.get(key);
      if (!entry) return () => {};
      entry.listeners.add(listener);
      return () => entry.listeners.delete(listener);
    },
    update: (key, update) => {
      const current = this.entries.get(key)?.state ?? initialState(null);
      const next = update(current);
      this.entries.set(key, {
        state: next,
        listeners: this.entries.get(key)?.listeners ?? new Set(),
      });
      if (current.requestChanged && !next.requestChanged) {
        const [projectId, taskIdText] = key.split(':');
        const prefix = taskPrefix(projectId ?? '', Number(taskIdText));
        for (const olderKey of this.entries.keys()) {
          if (olderKey !== key && olderKey.startsWith(prefix)) {
            this.entries.delete(olderKey);
            this.leases.delete(olderKey);
          }
        }
      }
      this.notify(key);
    },
  };

  get locked(): boolean {
    return [...this.entries.values()].some(({ state }) => hasInput(state)) || this.leases.size > 0;
  }

  operationsFor(projectId: ProjectId, taskId: number, requestId: string | null): OperationControls {
    const key = formKey(projectId, taskId, requestId);
    return {
      begin: (_kind: OperationKind, operationProjectId: ProjectId) => {
        const existing = this.leases.get(key);
        if (existing) return existing.id;
        const id = ++this.nextOperationId;
        this.leases.set(key, { id, projectId: operationProjectId, saving: false });
        this.notify();
        return id;
      },
      saveStarted: (id: number) => {
        const lease = this.leases.get(key);
        if (lease?.id === id) {
          lease.saving = true;
          this.notify();
        }
      },
      saveFailed: (id: number) => {
        const lease = this.leases.get(key);
        if (lease?.id === id) {
          lease.saving = false;
          this.notify();
        }
      },
      end: (id: number) => {
        const lease = this.leases.get(key);
        if (!lease || lease.id !== id || hasInput(this.entries.get(key)?.state)) return;
        this.leases.delete(key);
        this.notify();
      },
      taskRemoved: (id: number, removedProjectId: ProjectId, removedTaskId: number) => {
        if (id !== this.leases.get(key)?.id) return;
        if (removedProjectId === projectId && removedTaskId === taskId) {
          this.leases.delete(key);
          this.entries.delete(key);
          this.notify();
        }
      },
      isCurrent: (id: number, operationProjectId: ProjectId) => {
        const lease = this.leases.get(key);
        return lease?.id === id && lease.projectId === operationProjectId;
      },
    };
  }

  onAnswered(item: MonitorTask, requestId: string, result: AnswerResult): void {
    const key = formKey(item.projectId, item.task.id, requestId);
    if (this.staleRequests.has(key)) return;
    this.saved.set(`${item.projectId}:${item.task.id}`, { requestId, result });
    this.notify();
  }

  markRequestStale(projectId: ProjectId, taskId: number, requestId: string): void {
    this.staleRequests.add(formKey(projectId, taskId, requestId));
    this.notify();
  }

  orphanDrafts(tasks: readonly MonitorTask[]): OrphanAnswerDraft[] {
    const byId = new Map(tasks.map((item) => [`${item.projectId}:${item.task.id}`, item]));
    const drafts: OrphanAnswerDraft[] = [];
    for (const [key, entry] of this.entries) {
      if (!hasInput(entry.state)) continue;
      const [projectId, taskIdText, ...requestParts] = key.split(':');
      const current = byId.get(`${projectId}:${taskIdText}`);
      if (current) this.projectNames.set(current.projectId, current.projectName);
      if (current?.task.taskStatus === 'done') continue;
      if (
        current?.task.pendingRequestId &&
        current.task.pendingRequestId !== requestParts.join(':')
      )
        continue;
      if (!current) {
        drafts.push({
          key,
          projectName: this.projectNames.get(projectId ?? '') ?? '—',
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
  }

  clearOrphanDraft(key: AnswerFormKey): void {
    this.entries.delete(key);
    this.leases.delete(key);
    this.staleRequests.delete(key);
    this.notify();
  }

  reconcileTasks(tasks: readonly MonitorTask[]): void {
    const byId = new Map(tasks.map((item) => [`${item.projectId}:${item.task.id}`, item]));
    let changed = false;
    for (const key of this.entries.keys()) {
      const [projectId, taskIdText] = key.split(':');
      if (byId.get(`${projectId}:${taskIdText}`)?.task.taskStatus === 'done') {
        this.staleRequests.add(key);
        this.entries.delete(key);
        this.leases.delete(key);
        changed = true;
      }
    }
    for (const [key, receipt] of this.saved) {
      if (byId.get(key)?.task.taskStatus !== 'done') continue;
      const [projectId, taskIdText] = key.split(':');
      this.staleRequests.add(formKey(projectId ?? '', Number(taskIdText), receipt.requestId));
      this.saved.delete(key);
      changed = true;
    }
    if (changed) this.notify();
  }

  tasksWithSavedAnswers(tasks: readonly MonitorTask[], snapshotIsFresh: boolean): MonitorTask[] {
    const byId = new Map(tasks.map((item) => [`${item.projectId}:${item.task.id}`, item]));
    for (const [key, receipt] of this.saved) {
      const current = byId.get(key);
      if (snapshotIsFresh && current && current.task.pendingRequestId !== receipt.requestId) {
        this.saved.delete(key);
      }
    }
    return tasks.map((item) => {
      const receipt = this.saved.get(`${item.projectId}:${item.task.id}`);
      if (!receipt || item.task.pendingRequestId !== receipt.requestId) return item;
      return { ...item, task: receipt.result.task };
    });
  }

  wasAnswered(projectId: ProjectId, taskId: number, requestId: string | null): boolean {
    return (
      requestId !== null &&
      (this.saved.get(`${projectId}:${taskId}`)?.requestId === requestId ||
        this.staleRequests.has(formKey(projectId, taskId, requestId)))
    );
  }
}
