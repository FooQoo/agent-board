import { useEffect, useId, useRef } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import { useTranslation } from 'react-i18next';
import { Drawer } from '../../components/ui/drawer';
import { DetailTabList, detailPanelId, detailTabId } from '../../components/ui/detail-tabs';
import { HistoryTimeline } from '../../components/HistoryTimeline';
import { AcceptanceTabView } from '../../components/detail/AcceptanceTabView';
import { MonitorDocument } from './MonitorDocument';
import type { Epic, Problem } from '../../types';
import type { MonitorCard, MonitorDetailTab, MonitorReadResolvers } from '../contracts';
import type { EpicReadState } from '../hooks/useMonitorDetailDrawer';

const TAB_ORDER: MonitorDetailTab[] = ['description', 'acceptance', 'history', 'epic'];

export function shouldIgnoreTabSwipe(target: EventTarget | null, panel: HTMLElement): boolean {
  if (!(target instanceof Element)) return false;
  const targetDialog = target.closest('[role="dialog"]');
  const panelDialog = panel.closest('[role="dialog"]');
  if (targetDialog && targetDialog !== panelDialog) return true;
  if (
    target.closest(
      'button, a, input, textarea, select, summary, [contenteditable="true"], [data-no-tab-swipe], table, pre, code, img, picture, figure, .lightbox, .mermaid, .diagram',
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
  return (
    <MonitorDocument
      body={epic.body}
      acceptanceError={false}
      attachments={epic.attachments ?? []}
      evidence={[]}
      attachmentUrl={(id) => resolvers.epicAttachmentUrl(projectId, epic.id, id)}
    />
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
  const tabsRef = useRef<HTMLDivElement>(null);
  const [carouselRef, carousel] = useEmblaCarousel({
    loop: false,
    watchFocus: false,
    watchDrag: (api, event) =>
      !window.getSelection()?.toString() && !shouldIgnoreTabSwipe(event.target, api.rootNode()),
  });
  const initializedCarousel = useRef<typeof carousel>(undefined);
  useEffect(() => {
    if (!carousel) return;
    const index = TAB_ORDER.indexOf(tab);
    if (initializedCarousel.current !== carousel || carousel.selectedScrollSnap() !== index) {
      carousel.scrollTo(index, initializedCarousel.current !== carousel);
    }
    initializedCarousel.current = carousel;
  }, [carousel, tab]);
  useEffect(() => {
    if (!carousel) return;
    const onSelected = () => {
      const next = TAB_ORDER[carousel.selectedScrollSnap()];
      if (next && next !== tab) onTabChange(next);
    };
    const updateIndicator = () => {
      const progress = Math.max(0, Math.min(1, carousel.scrollProgress()));
      tabsRef.current?.style.setProperty('--tab-progress', String(progress));
    };
    updateIndicator();
    carousel.on('select', onSelected);
    carousel.on('scroll', updateIndicator);
    carousel.on('reInit', updateIndicator);
    return () => {
      carousel.off('select', onSelected);
      carousel.off('scroll', updateIndicator);
      carousel.off('reInit', updateIndicator);
    };
  }, [carousel, tab, onTabChange]);
  if (!item) {
    // Mount the root closed so the first interaction also runs the enter transition.
    return (
      <Drawer open={false} onOpenChange={onOpenChange} identity="" title="">
        {null}
      </Drawer>
    );
  }
  const card = item.card;
  const filtered = card.history;

  const tabs = [
    {
      id: 'description' as const,
      label: t('monitor.body'),
      icon: null,
    },
    {
      id: 'acceptance' as const,
      label: t('detail.tabAcceptance'),
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
              body={card.body}
              acceptanceError={card.acceptanceError}
              problems={problems.filter(
                (problem) =>
                  problem.projectId === item.projectId &&
                  problem.file.startsWith(`projects/${item.projectId}/tasks/${card.id}/`),
              )}
              attachments={card.attachments ?? []}
              evidence={card.evidence ?? []}
              attachmentUrl={(id) => resolvers.attachmentUrl(item.projectId, card.id, id)}
              evidenceUrl={(id) => resolvers.evidenceUrl(item.projectId, card.id, id)}
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
            <AcceptanceTabView card={card} />
          </div>
          <div
            role="tabpanel"
            id={detailPanelId(idBase, 'history')}
            aria-labelledby={detailTabId(idBase, 'history')}
            aria-hidden={tab !== 'history'}
            inert={tab !== 'history'}
            className="monitor-drawer__panel"
          >
            <HistoryTimeline events={filtered} />
          </div>
          <div
            role="tabpanel"
            id={detailPanelId(idBase, 'epic')}
            aria-labelledby={detailTabId(idBase, 'epic')}
            aria-hidden={tab !== 'epic'}
            inert={tab !== 'epic'}
            className="monitor-drawer__panel"
          >
            {card.epic ? (
              <EpicContent
                state={epicRead.status === 'idle' ? { status: 'loading' } : epicRead}
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
      </div>
    </Drawer>
  );
}
