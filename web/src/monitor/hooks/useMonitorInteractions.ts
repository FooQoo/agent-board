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
import type { MonitorCard } from '../contracts';

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
  cardId: number;
  text: string;
  choiceId: string | null;
}

export interface MonitorAnswerController {
  writeAnswer: AnswerWriter;
  stateStore: AnswerFormStateStore;
  operationsFor(projectId: ProjectId, cardId: number, requestId: string | null): OperationControls;
  onAnswered(item: MonitorCard, requestId: string, result: AnswerResult): void;
  markRequestStale(projectId: ProjectId, cardId: number, requestId: string): void;
  orphanDrafts(cards: readonly MonitorCard[]): OrphanAnswerDraft[];
  clearOrphanDraft(key: AnswerFormKey): void;
  reconcileCards(cards: readonly MonitorCard[]): void;
  cardsWithSavedAnswers(cards: readonly MonitorCard[], snapshotIsFresh: boolean): MonitorCard[];
  wasAnswered(projectId: ProjectId, cardId: number, requestId: string | null): boolean;
  locked: boolean;
}

const defaultWriter: AnswerWriter = async () => {
  throw new Error('Monitor answer writer is not connected.');
};

function formKey(projectId: ProjectId, cardId: number, requestId: string | null): AnswerFormKey {
  return `${projectId}:${cardId}:${requestId ?? ''}` as AnswerFormKey;
}

function cardPrefix(projectId: ProjectId, cardId: number): string {
  return `${projectId}:${cardId}:`;
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
        const [projectId, cardIdText, ...requestParts] = key.split(':');
        const cardId = Number(cardIdText);
        const prefix = cardPrefix(projectId ?? '', cardId);
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
          const [projectId, cardIdText] = key.split(':');
          const prefix = cardPrefix(projectId ?? '', Number(cardIdText));
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
    (projectId: ProjectId, cardId: number, requestId: string | null): OperationControls => {
      const key = formKey(projectId, cardId, requestId);
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
        cardRemoved(id, removedProjectId, removedCardId) {
          if (id !== leases.current.get(key)?.id) return;
          if (removedProjectId === projectId && removedCardId === cardId) {
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
    (item: MonitorCard, requestId: string, result: AnswerResult) => {
      const requestKey = formKey(item.projectId, item.card.id, requestId);
      if (staleRequests.current.has(requestKey)) return;
      saved.current.set(`${item.projectId}:${item.card.id}`, { requestId, result });
      notify();
    },
    [notify],
  );

  const markRequestStale = useCallback(
    (projectId: ProjectId, cardId: number, requestId: string) => {
      staleRequests.current.add(formKey(projectId, cardId, requestId));
      notify();
    },
    [notify],
  );

  const orphanDrafts = useCallback((cards: readonly MonitorCard[]) => {
    const byId = new Map(cards.map((item) => [`${item.projectId}:${item.card.id}`, item]));
    const drafts: OrphanAnswerDraft[] = [];
    for (const [key, entry] of entries.current) {
      if (!hasInput(entry.state)) continue;
      const [projectId, cardIdText, ...requestParts] = key.split(':');
      const current = byId.get(`${projectId}:${cardIdText}`);
      if (current) projectNames.current.set(current.projectId, current.projectName);
      if (current?.card.cardStatus === 'done') continue;
      if (
        current?.card.pendingRequestId &&
        current.card.pendingRequestId !== requestParts.join(':')
      )
        continue;
      if (!current) {
        drafts.push({
          key,
          projectName: projectNames.current.get(projectId ?? '') ?? '—',
          cardId: Number(cardIdText),
          text: entry.state.text,
          choiceId: entry.state.choiceId,
        });
      } else if (current.card.pendingRequestId === null) {
        drafts.push({
          key,
          projectName: current.projectName,
          cardId: current.card.id,
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

  const reconcileCards = useCallback(
    (cards: readonly MonitorCard[]) => {
      const byId = new Map(cards.map((item) => [`${item.projectId}:${item.card.id}`, item]));
      let changed = false;
      for (const key of entries.current.keys()) {
        const [projectId, cardIdText] = key.split(':');
        if (byId.get(`${projectId}:${cardIdText}`)?.card.cardStatus === 'done') {
          staleRequests.current.add(key);
          entries.current.delete(key);
          leases.current.delete(key);
          changed = true;
        }
      }
      for (const [key, receipt] of saved.current) {
        if (byId.get(key)?.card.cardStatus !== 'done') continue;
        const [projectId, cardIdText] = key.split(':');
        staleRequests.current.add(formKey(projectId ?? '', Number(cardIdText), receipt.requestId));
        saved.current.delete(key);
        changed = true;
      }
      if (changed) notify();
    },
    [notify],
  );

  const cardsWithSavedAnswers = useCallback(
    (cards: readonly MonitorCard[], snapshotIsFresh: boolean) => {
      const byId = new Map(cards.map((item) => [`${item.projectId}:${item.card.id}`, item]));
      for (const [key, receipt] of saved.current) {
        const current = byId.get(key);
        if (snapshotIsFresh && current && current.card.pendingRequestId !== receipt.requestId) {
          saved.current.delete(key);
        }
      }
      return cards.map((item) => {
        const receipt = saved.current.get(`${item.projectId}:${item.card.id}`);
        if (!receipt || item.card.pendingRequestId !== receipt.requestId) return item;
        return { ...item, card: receipt.result.card };
      });
    },
    [],
  );

  const wasAnswered = useCallback(
    (projectId: ProjectId, cardId: number, requestId: string | null) => {
      return (
        requestId !== null &&
        (saved.current.get(`${projectId}:${cardId}`)?.requestId === requestId ||
          staleRequests.current.has(formKey(projectId, cardId, requestId)))
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
    reconcileCards,
    cardsWithSavedAnswers,
    wasAnswered,
    locked,
  };
}
