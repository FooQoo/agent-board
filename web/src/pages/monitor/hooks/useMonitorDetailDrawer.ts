import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Epic, Project } from '../../../shared/api/contracts';
import type { MonitorTask, MonitorDetailTab, MonitorReadResolvers } from '../contracts';

export type EpicReadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; epic: Epic }
  | { status: 'partial'; epic: Epic }
  | { status: 'error'; cause: unknown }
  | { status: 'not-found' };

interface DrawerTarget {
  projectId: string;
  taskId: number;
  item: MonitorTask;
}

type ProjectEpics =
  | { status: 'loading' }
  | { status: 'loaded'; epics: Epic[] }
  | { status: 'error'; cause: unknown };

export function useMonitorDetailDrawer(
  tasks: readonly MonitorTask[],
  resolvers: MonitorReadResolvers,
  projects: readonly Project[],
) {
  const [target, setTarget] = useState<DrawerTarget | null>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<MonitorDetailTab>('description');
  const [retry, setRetry] = useState(0);
  const [projectEpics, setProjectEpics] = useState<Record<string, ProjectEpics>>({});
  const generation = useRef(0);

  const currentItem = useMemo(() => {
    if (!target) return null;
    return (
      tasks.find((item) => item.projectId === target.projectId && item.task.id === target.taskId) ??
      target.item
    );
  }, [tasks, target]);

  const show = useCallback((item: MonitorTask, nextTab: MonitorDetailTab) => {
    setTarget({ projectId: item.projectId, taskId: item.task.id, item });
    setTab(nextTab);
    setOpen(true);
  }, []);
  const close = useCallback((nextOpen: boolean) => setOpen(nextOpen), []);
  const retryEpic = useCallback(() => setRetry((value) => value + 1), []);
  const changeTab = useCallback((nextTab: MonitorDetailTab) => setTab(nextTab), []);
  const requestKey = [String(retry), ...projects.map((project) => project.id).sort()].join(':');

  // Load complete epic lists when the monitor is drawn. Tab changes only read this cache.
  useEffect(() => {
    const mine = ++generation.current;
    const controller = new AbortController();
    const [, ...projectIds] = requestKey.split(':');
    setProjectEpics(Object.fromEntries(projectIds.map((id) => [id, { status: 'loading' }])));
    for (const id of projectIds) {
      void resolvers.getEpics(id, controller.signal).then(
        (epics) => {
          if (mine !== generation.current || controller.signal.aborted) return;
          setProjectEpics((previous) => ({ ...previous, [id]: { status: 'loaded', epics } }));
        },
        (cause: unknown) => {
          if (mine !== generation.current || controller.signal.aborted) return;
          setProjectEpics((previous) => ({ ...previous, [id]: { status: 'error', cause } }));
        },
      );
    }
    return () => {
      controller.abort();
      generation.current++;
    };
  }, [requestKey, resolvers]);

  const epicId = currentItem?.task.epic?.id;
  const cached = currentItem ? projectEpics[currentItem.projectId] : undefined;
  let epicRead: EpicReadState = { status: 'idle' };
  if (epicId) {
    if (!cached || cached.status === 'loading') epicRead = { status: 'loading' };
    else if (cached.status === 'error') epicRead = cached;
    else {
      const epic = cached.epics.find((item) => item.id === epicId);
      if (!epic) epicRead = { status: 'not-found' };
      else {
        const partial = typeof epic.body !== 'string' || !Array.isArray(epic.attachments);
        epicRead = partial ? { status: 'partial', epic } : { status: 'loaded', epic };
      }
    }
  }
  return { target: currentItem, open, tab, epicRead, show, close, setTab: changeTab, retryEpic };
}
