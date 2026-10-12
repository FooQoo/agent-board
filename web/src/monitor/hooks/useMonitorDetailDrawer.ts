import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Epic } from '../../types';
import type { MonitorCard, MonitorDetailTab, MonitorReadResolvers } from '../contracts';

export type EpicReadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; epic: Epic }
  | { status: 'partial'; epic: Epic }
  | { status: 'error'; cause: unknown }
  | { status: 'not-found' };

interface DrawerTarget {
  projectId: string;
  cardId: number;
  item: MonitorCard;
}

interface KeyedEpicReadState {
  key: string;
  value: EpicReadState;
}

export function useMonitorDetailDrawer(
  cards: readonly MonitorCard[],
  resolvers: MonitorReadResolvers,
) {
  const [target, setTarget] = useState<DrawerTarget | null>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<MonitorDetailTab>('description');
  const [retry, setRetry] = useState(0);
  const [epicReadState, setEpicReadState] = useState<KeyedEpicReadState>({
    key: '',
    value: { status: 'idle' },
  });
  const generation = useRef(0);

  const currentItem = useMemo(() => {
    if (!target) return null;
    return (
      cards.find((item) => item.projectId === target.projectId && item.card.id === target.cardId) ??
      target.item
    );
  }, [cards, target]);

  const show = useCallback((item: MonitorCard, nextTab: MonitorDetailTab) => {
    setTarget({ projectId: item.projectId, cardId: item.card.id, item });
    setTab(nextTab);
    setEpicReadState({
      key: `${item.projectId}:${item.card.id}:${item.card.epic?.id ?? ''}`,
      value: item.card.epic && nextTab === 'epic' ? { status: 'loading' } : { status: 'idle' },
    });
    setOpen(true);
  }, []);
  const close = useCallback((nextOpen: boolean) => setOpen(nextOpen), []);
  const retryEpic = useCallback(() => setRetry((value) => value + 1), []);
  const changeTab = useCallback(
    (nextTab: MonitorDetailTab) => {
      setTab(nextTab);
      if (nextTab === 'epic' && currentItem?.card.epic) {
        setEpicReadState({
          key: `${currentItem.projectId}:${currentItem.card.id}:${currentItem.card.epic.id}`,
          value: { status: 'loading' },
        });
      }
    },
    [currentItem],
  );

  const epicId = currentItem?.card.epic?.id ?? null;
  const projectId = currentItem?.projectId ?? null;
  const cardId = currentItem?.card.id ?? null;
  const request = useMemo(
    () => ({ projectId, cardId, epicId, updatedAt: currentItem?.card.updatedAt ?? null, retry }),
    [projectId, cardId, epicId, currentItem?.card.updatedAt, retry],
  );
  const readKey = `${request.projectId ?? ''}:${request.cardId ?? ''}:${request.epicId ?? ''}:${request.updatedAt ?? ''}:${request.retry}`;
  useEffect(() => {
    const mine = ++generation.current;
    if (!open || tab !== 'epic' || !request.epicId || !request.projectId) {
      setEpicReadState({ key: readKey, value: { status: 'idle' } });
      return;
    }
    const controller = new AbortController();
    setEpicReadState({ key: readKey, value: { status: 'loading' } });
    void resolvers.getEpic(request.projectId, request.epicId, controller.signal).then(
      (epic) => {
        if (mine !== generation.current || controller.signal.aborted) return;
        const partial =
          typeof epic.body !== 'string' ||
          !Array.isArray(epic.acceptance) ||
          !Array.isArray(epic.attachments);
        setEpicReadState({
          key: readKey,
          value: partial ? { status: 'partial', epic } : { status: 'loaded', epic },
        });
      },
      (cause: unknown) => {
        if (mine !== generation.current || controller.signal.aborted) return;
        const status =
          typeof cause === 'object' && cause !== null && 'status' in cause ? cause.status : null;
        setEpicReadState({
          key: readKey,
          value: status === 404 ? { status: 'not-found' } : { status: 'error', cause },
        });
      },
    );
    return () => {
      controller.abort();
      generation.current++;
    };
  }, [open, tab, request, readKey, resolvers]);

  const epicRead =
    epicReadState.key === readKey
      ? epicReadState.value
      : open && tab === 'epic' && epicId
        ? { status: 'loading' as const }
        : { status: 'idle' as const };
  return { target: currentItem, open, tab, epicRead, show, close, setTab: changeTab, retryEpic };
}
