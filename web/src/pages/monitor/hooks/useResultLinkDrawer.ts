import { useEffect, useRef } from 'react';
import type { ResultLinkTarget } from '../../../features/tasks/results/resultLink';
import type { MonitorDetailTab, MonitorTask } from '../contracts';

/**
 * A result link opens its task's drawer on the results tab once the list has the task, and only
 * once per link, so closing the drawer is not undone.
 */
export function useResultLinkDrawer(
  tasks: readonly MonitorTask[],
  resultLink: ResultLinkTarget | null,
  show: (item: MonitorTask, tab: MonitorDetailTab) => void,
) {
  const opened = useRef<string | null>(null);
  const linked =
    resultLink === null ? undefined : tasks.find((item) => item.task.id === resultLink.taskId);
  useEffect(() => {
    if (resultLink === null || linked === undefined) return;
    const key = `${linked.projectId}:${resultLink.taskId}:${resultLink.version}`;
    if (opened.current === key) return;
    opened.current = key;
    show(linked, 'results');
  }, [resultLink, linked, show]);
}
