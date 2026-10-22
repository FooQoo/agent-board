import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DetailTabList, detailPanelId, detailTabId } from '../../../shared/ui/detail-tabs';
import { TaskAcceptanceTab, TaskBodyTab, TaskHistoryTab } from './MonitorTaskTabs';
import { MonitorEpicContent } from './MonitorEpicContent';
import type { Problem } from '../../../shared/api/contracts';
import type { MonitorTask, MonitorDetailTab, MonitorReadResolvers } from '../contracts';
import { useMonitorTabSwipe } from '../hooks/useMonitorTabSwipe';

export function MonitorDrawerPanels({
  item,
  tab,
  onTabChange,
  resolvers,
  problems,
}: {
  item: MonitorTask;
  tab: MonitorDetailTab;
  onTabChange(tab: MonitorDetailTab): void;
  resolvers: MonitorReadResolvers;
  problems: readonly (Problem & { projectId: string })[];
}) {
  const { t } = useTranslation();
  const idBase = useId();
  const { tabsRef, carouselRef } = useMonitorTabSwipe(tab, onTabChange);
  const task = item.task;
  // The active panel scrolls the document; a long one is drawn only near the viewport.
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const panelRef = (id: MonitorDetailTab) => (tab === id ? setScroller : undefined);
  const problemsOfTask = problems.filter(
    (problem) =>
      problem.projectId === item.projectId &&
      problem.file.startsWith(`projects/${item.projectId}/tasks/${task.id}/`),
  );
  const tabs = [
    { id: 'description' as const, label: t('monitor.body'), icon: null },
    { id: 'acceptance' as const, label: t('detail.tabAcceptance'), icon: null },
    { id: 'history' as const, label: t('detail.tabHistory'), icon: null },
    { id: 'epic' as const, label: t('monitor.epic'), icon: null },
  ];

  return (
    <>
      <div className="monitor-drawer__tabs" ref={tabsRef}>
        <DetailTabList
          idBase={idBase}
          tabs={tabs}
          selected={tab}
          onChange={onTabChange}
          wrap={false}
          className="monitor-drawer__tablist"
        />
      </div>
      <div
        className="monitor-drawer__panels"
        ref={carouselRef}
        data-base-ui-swipe-ignore=""
        onPointerDown={(event) => event.stopPropagation()}
        onPointerMove={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onPointerCancel={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
        onTouchMove={(event) => event.stopPropagation()}
        onTouchEnd={(event) => event.stopPropagation()}
        onTouchCancel={(event) => event.stopPropagation()}
      >
        <div className="monitor-drawer__track">
          <div
            role="tabpanel"
            id={detailPanelId(idBase, 'description')}
            ref={panelRef('description')}
            aria-labelledby={detailTabId(idBase, 'description')}
            aria-hidden={tab !== 'description'}
            inert={tab !== 'description'}
            className="monitor-drawer__panel"
          >
            {tab === 'description' && (
              <TaskBodyTab
                item={item}
                resolvers={resolvers}
                scrollParent={scroller}
                problems={problemsOfTask}
              />
            )}
          </div>
          <div
            role="tabpanel"
            id={detailPanelId(idBase, 'acceptance')}
            ref={panelRef('acceptance')}
            aria-labelledby={detailTabId(idBase, 'acceptance')}
            aria-hidden={tab !== 'acceptance'}
            inert={tab !== 'acceptance'}
            className="monitor-drawer__panel"
          >
            {tab === 'acceptance' && <TaskAcceptanceTab item={item} />}
          </div>
          <div
            role="tabpanel"
            id={detailPanelId(idBase, 'history')}
            ref={panelRef('history')}
            aria-labelledby={detailTabId(idBase, 'history')}
            aria-hidden={tab !== 'history'}
            inert={tab !== 'history'}
            className="monitor-drawer__panel"
          >
            {tab === 'history' && <TaskHistoryTab item={item} />}
          </div>
          <div
            role="tabpanel"
            id={detailPanelId(idBase, 'epic')}
            ref={panelRef('epic')}
            aria-labelledby={detailTabId(idBase, 'epic')}
            aria-hidden={tab !== 'epic'}
            inert={tab !== 'epic'}
            className="monitor-drawer__panel"
          >
            {tab === 'epic' && (
              <MonitorEpicContent
                projectId={item.projectId}
                epicId={task.epic?.id ?? null}
                resolvers={resolvers}
                scrollParent={scroller}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
