import { useCallback, useMemo, useState } from 'react';
import type { MonitorTask, MonitorDetailTab } from '../contracts';

interface DrawerTarget {
  projectId: string;
  taskId: number;
  item: MonitorTask;
}

/**
 * Which card the drawer shows, whether it is open and which tab is active. The drawer opens with
 * the card it was given; while the list is updated, it shows the newest version of that card.
 * What a tab needs is read by the tab itself, so opening only costs what the active tab asks for.
 */
export function useMonitorDetailDrawer(tasks: readonly MonitorTask[]) {
  const [target, setTarget] = useState<DrawerTarget | null>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<MonitorDetailTab>('description');

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
  const changeTab = useCallback((nextTab: MonitorDetailTab) => setTab(nextTab), []);
  return { target: currentItem, open, tab, show, close, setTab: changeTab };
}
