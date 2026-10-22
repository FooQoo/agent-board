import { useTranslation } from 'react-i18next';
import { Drawer } from '../../../shared/ui/drawer';
import { MonitorDrawerPanels } from './MonitorDrawerPanels';
import type { Problem } from '../../../shared/api/contracts';
import type { MonitorTask, MonitorDetailTab, MonitorReadResolvers } from '../contracts';

export { shouldIgnoreTabSwipe } from '../hooks/useMonitorTabSwipe';

export function MonitorDetailDrawer({
  item,
  open,
  tab,
  onOpenChange,
  onTabChange,
  resolvers,
  problems = [],
}: {
  item: MonitorTask | null;
  open: boolean;
  tab: MonitorDetailTab;
  onOpenChange(open: boolean): void;
  onTabChange(tab: MonitorDetailTab): void;
  resolvers: MonitorReadResolvers;
  problems?: readonly (Problem & { projectId: string })[];
}) {
  const { t } = useTranslation();
  if (!item) {
    // Mount the root closed so the first interaction also runs the enter transition.
    return (
      <Drawer open={false} onOpenChange={onOpenChange} identity="" title="">
        {null}
      </Drawer>
    );
  }

  const task = item.task;
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      identity={t('monitor.drawerIdentity', { id: task.id })}
      title={task.title}
      label={
        task.epic ? (
          <span className="mobile-drawer__epic-label" title={task.epic.name}>
            {task.epic.id}
          </span>
        ) : null
      }
    >
      <MonitorDrawerPanels
        item={item}
        tab={tab}
        onTabChange={onTabChange}
        resolvers={resolvers}
        problems={problems}
      />
    </Drawer>
  );
}
