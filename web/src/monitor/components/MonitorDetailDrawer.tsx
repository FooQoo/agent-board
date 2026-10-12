import { useId, useRef, type TouchEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Drawer } from '../../components/ui/drawer';
import { DetailTabList, detailPanelId, detailTabId } from '../../components/ui/detail-tabs';
import { HistoryTimeline } from '../../components/HistoryTimeline';
import { BodyDocumentView } from '../../components/detail/BodyDocumentView';
import type { Epic, Problem } from '../../types';
import type { MonitorCard, MonitorDetailTab, MonitorReadResolvers } from '../contracts';
import type { EpicReadState } from '../hooks/useMonitorDetailDrawer';

const TAB_ORDER: MonitorDetailTab[] = ['description', 'history', 'epic'];

export function nextTabForSwipe(
  tab: MonitorDetailTab,
  dx: number,
  dy: number,
): MonitorDetailTab | null {
  if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  const current = TAB_ORDER.indexOf(tab);
  const next = dx < 0 ? current + 1 : current - 1;
  return next >= 0 && next < TAB_ORDER.length ? (TAB_ORDER[next] ?? null) : null;
}

export function shouldIgnoreTabSwipe(target: EventTarget | null, panel: HTMLElement): boolean {
  if (!(target instanceof Element)) return false;
  const targetDialog = target.closest('[role="dialog"]');
  const panelDialog = panel.closest('[role="dialog"]');
  if (targetDialog && targetDialog !== panelDialog) return true;
  if (
    target.closest(
      'button, a, input, textarea, select, [contenteditable="true"], [data-no-tab-swipe], table, pre, code, img, picture, figure, .lightbox, .mermaid, .diagram',
    )
  )
    return true;
  let node: Element | null = target;
  while (node && node !== panel) {
    const style = getComputedStyle(node);
    if (
      (style.overflowX === 'auto' || style.overflowX === 'scroll') &&
      node.scrollWidth > node.clientWidth + 1
    )
      return true;
    node = node.parentElement;
  }
  return false;
}

function EpicContent({
  state,
  retry,
  projectId,
  resolvers,
}: {
  state: EpicReadState;
  retry(): void;
  projectId: string;
  resolvers: MonitorReadResolvers;
}) {
  const { t } = useTranslation();
  if (state.status === 'idle')
    return <p className="monitor-drawer__notice">{t('monitor.epicNotAssigned')}</p>;
  if (state.status === 'loading')
    return (
      <p className="monitor-drawer__notice" role="status">
        {t('monitor.epicLoading')}
      </p>
    );
  if (state.status === 'not-found')
    return (
      <p className="monitor-drawer__notice" role="status">
        {t('monitor.epicNotFound')}
      </p>
    );
  if (state.status === 'error') {
    return (
      <div className="monitor-drawer__notice" role="alert">
        <p>{t('monitor.epicError')}</p>
        <button type="button" className="monitor-drawer__retry" onClick={retry}>
          {t('monitor.retry')}
        </button>
      </div>
    );
  }
  return (
    <>
      {state.status === 'partial' && (
        <p className="monitor-drawer__partial" role="status">
          {t('monitor.epicPartial')}
        </p>
      )}
      <EpicDocument epic={state.epic} projectId={projectId} resolvers={resolvers} />
    </>
  );
}

function EpicDocument({
  epic,
  projectId,
  resolvers,
}: {
  epic: Epic;
  projectId: string;
  resolvers: MonitorReadResolvers;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="monitor-drawer__epic-heading">
        <span className="monitor-drawer__epic-id">{epic.id}</span>
        <h3>{epic.name}</h3>
      </div>
      {epic.acceptanceError && (
        <p className="monitor-drawer__partial" role="status">
          {t('acceptance.unreadableTitle')}
        </p>
      )}
      <BodyDocumentView
        body={epic.body}
        acceptance={epic.acceptance ?? []}
        acceptanceError={epic.acceptanceError}
        attachments={epic.attachments ?? []}
        evidence={[]}
        attachmentUrl={(id) => resolvers.epicAttachmentUrl(projectId, epic.id, id)}
      />
    </>
  );
}

export function MonitorDetailDrawer({
  item,
  open,
  tab,
  epicRead,
  onOpenChange,
  onTabChange,
  onRetryEpic,
  resolvers,
  problems = [],
}: {
  item: MonitorCard | null;
  open: boolean;
  tab: MonitorDetailTab;
  epicRead: EpicReadState;
  onOpenChange(open: boolean): void;
  onTabChange(tab: MonitorDetailTab): void;
  onRetryEpic(): void;
  resolvers: MonitorReadResolvers;
  problems?: readonly (Problem & { projectId: string })[];
}) {
  const { t } = useTranslation();
  const idBase = useId();
  const touchStart = useRef<{ x: number; y: number; eligible: boolean } | null>(null);
  if (!item) return null;
  const card = item.card;
  const filtered = card.history;
  const onTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const point = event.touches[0];
    if (!point) return;
    touchStart.current = {
      x: point.clientX,
      y: point.clientY,
      eligible: !shouldIgnoreTabSwipe(event.target, event.currentTarget),
    };
  };
  const onTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const point = event.changedTouches[0];
    const start = touchStart.current;
    touchStart.current = null;
    if (!start?.eligible || !point || window.getSelection()?.toString()) return;
    const dx = point.clientX - start.x;
    const dy = point.clientY - start.y;
    const next = nextTabForSwipe(tab, dx, dy);
    if (next) onTabChange(next);
  };

  const tabs = [
    {
      id: 'description' as const,
      label: t('monitor.body'),
      icon: null,
    },
    {
      id: 'history' as const,
      label: t('detail.tabHistory'),
      icon: null,
    },
    { id: 'epic' as const, label: t('monitor.epic'), icon: null },
  ];
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      identity={t('monitor.drawerIdentity', { id: card.id })}
      title={card.title}
      label={
        card.epic ? (
          <span className="mobile-drawer__epic-label" title={card.epic.name}>
            {card.epic.id}
          </span>
        ) : null
      }
    >
      <div className="monitor-drawer__tabs">
        <DetailTabList
          idBase={idBase}
          tabs={tabs}
          selected={tab}
          onChange={onTabChange}
          wrap={false}
          className="detail__tablist monitor-drawer__tablist"
        />
      </div>
      <div
        className="monitor-drawer__panels"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onTouchCancel={() => {
          touchStart.current = null;
        }}
      >
        <div
          role="tabpanel"
          id={detailPanelId(idBase, 'description')}
          aria-labelledby={detailTabId(idBase, 'description')}
          hidden={tab !== 'description'}
          className="detail__viewport monitor-drawer__panel"
        >
          <BodyDocumentView
            body={card.body}
            acceptance={card.acceptance}
            acceptanceError={card.acceptanceError}
            problems={problems.filter(
              (problem) =>
                problem.projectId === item.projectId &&
                problem.file.startsWith(`projects/${item.projectId}/tasks/${card.id}/`),
            )}
            attachments={card.attachments ?? []}
            evidence={card.evidence ?? []}
            projectId={item.projectId}
            cardId={card.id}
            attachmentUrl={(id) => resolvers.attachmentUrl(item.projectId, card.id, id)}
            evidenceUrl={(id) => resolvers.evidenceUrl(item.projectId, card.id, id)}
          />
        </div>
        <div
          role="tabpanel"
          id={detailPanelId(idBase, 'history')}
          aria-labelledby={detailTabId(idBase, 'history')}
          hidden={tab !== 'history'}
          className="detail__viewport monitor-drawer__panel"
        >
          <HistoryTimeline events={filtered} />
        </div>
        <div
          role="tabpanel"
          id={detailPanelId(idBase, 'epic')}
          aria-labelledby={detailTabId(idBase, 'epic')}
          hidden={tab !== 'epic'}
          className="detail__viewport monitor-drawer__panel"
        >
          {card.epic ? (
            <EpicContent
              state={epicRead}
              retry={onRetryEpic}
              projectId={item.projectId}
              resolvers={resolvers}
            />
          ) : (
            <EpicContent
              state={{ status: 'idle' }}
              retry={onRetryEpic}
              projectId={item.projectId}
              resolvers={resolvers}
            />
          )}
        </div>
      </div>
    </Drawer>
  );
}
