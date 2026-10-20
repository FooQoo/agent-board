import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { DetailTabList, detailPanelId, detailTabId } from '../../../shared/ui/detail-tabs';
import { HistoryTimeline } from '../../../features/tasks/history/HistoryTimeline';
import { AcceptanceTabView } from '../../../features/tasks/detail/AcceptanceTabView';
import { MonitorDocument } from './MonitorDocument';
import { MonitorEpicContent } from './MonitorEpicContent';
import type { Problem } from '../../../shared/api/contracts';
import type { MonitorTask, MonitorDetailTab, MonitorReadResolvers } from '../contracts';
import type { EpicReadState } from '../hooks/useMonitorDetailDrawer';
import { useMonitorTabSwipe } from '../hooks/useMonitorTabSwipe';

export function MonitorDrawerPanels({
  item,
  tab,
  epicRead,
  onTabChange,
  onRetryEpic,
  resolvers,
  problems,
}: {
  item: MonitorTask;
  tab: MonitorDetailTab;
  epicRead: EpicReadState;
  onTabChange(tab: MonitorDetailTab): void;
  onRetryEpic(): void;
  resolvers: MonitorReadResolvers;
  problems: readonly (Problem & { projectId: string })[];
}) {
  const { t } = useTranslation();
  const idBase = useId();
  const { tabsRef, carouselRef } = useMonitorTabSwipe(tab, onTabChange);
  const task = item.task;
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
            aria-labelledby={detailTabId(idBase, 'description')}
            aria-hidden={tab !== 'description'}
            inert={tab !== 'description'}
            className="monitor-drawer__panel"
          >
            <MonitorDocument
              body={task.body}
              acceptanceError={task.acceptanceError}
              problems={problems.filter(
                (problem) =>
                  problem.projectId === item.projectId &&
                  problem.file.startsWith(`projects/${item.projectId}/tasks/${task.id}/`),
              )}
              attachments={task.attachments ?? []}
              attachmentUrl={(id) => resolvers.attachmentUrl(item.projectId, task.id, id)}
            />
          </div>
          <div
            role="tabpanel"
            id={detailPanelId(idBase, 'acceptance')}
            aria-labelledby={detailTabId(idBase, 'acceptance')}
            aria-hidden={tab !== 'acceptance'}
            inert={tab !== 'acceptance'}
            className="monitor-drawer__panel"
          >
            <AcceptanceTabView task={task} />
          </div>
          <div
            role="tabpanel"
            id={detailPanelId(idBase, 'history')}
            aria-labelledby={detailTabId(idBase, 'history')}
            aria-hidden={tab !== 'history'}
            inert={tab !== 'history'}
            className="monitor-drawer__panel"
          >
            <HistoryTimeline events={task.history} />
          </div>
          <div
            role="tabpanel"
            id={detailPanelId(idBase, 'epic')}
            aria-labelledby={detailTabId(idBase, 'epic')}
            aria-hidden={tab !== 'epic'}
            inert={tab !== 'epic'}
            className="monitor-drawer__panel"
          >
            <MonitorEpicContent
              state={
                task.epic
                  ? epicRead.status === 'idle'
                    ? { status: 'loading' }
                    : epicRead
                  : { status: 'idle' }
              }
              retry={onRetryEpic}
              projectId={item.projectId}
              resolvers={resolvers}
            />
          </div>
        </div>
      </div>
    </>
  );
}
