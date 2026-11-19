import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { shouldIgnoreTabSwipe } from '../../../shared/lib/gesture/tabSwipe';
import { useSwipePages } from '../../../shared/lib/gesture/useSwipePages';
import { stateLabel } from '../model/format';
import type { EpicRef, Problem, ProjectId, TaskSummary } from '../../../shared/api/contracts';
import type { SectionSnapshot } from '../../../shared/data/core';
import { AssigneeLabel } from '../assignee/AssigneeLabel';
import { HistoryTimeline } from '../history/HistoryTimeline';
import { StatusLabel } from '../status/StatusLabel';
import { BodyDocumentView } from './BodyDocumentView';
import { DETAIL_TABS, type DetailTab, DetailTabs, panelId, tabId } from './DetailTabs';
import { DraftStatus } from './DraftStatus';
import { EpicTabView, type EpicTabStatus } from './EpicTabView';
import { AcceptanceTabView } from './AcceptanceTabView';
import { DetailSectionView } from './DetailSection';
import { DetailHeader } from './DetailHeader';
import './detail.css';

export interface TaskDetailViewProps {
  projectId: ProjectId;
  /** The card, as the Summary lists it. The text, conditions and history come from the sections below. */
  task: TaskSummary;
  /** The task's `document` section; read while the description or conditions tab is shown. */
  document: SectionSnapshot<'document'>;
  /** The task's `history` section; read while the history tab is shown. */
  history: SectionSnapshot<'history'>;
  /** The card's epic `document` section; read the first time the epic tab is shown. */
  epicDocument: SectionSnapshot<'document'>;
  onRetryDocument?: () => void;
  onRetryHistory?: () => void;
  onRetryEpicDocument?: () => void;
  tab: DetailTab;
  onTabChange(tab: DetailTab): void;
  onClose(): void;
  attachmentUrl?: (id: string) => string;
  problems?: readonly Problem[];
  /** The epics of the project, when they are read. Undefined while they load. */
  epics?: readonly EpicRef[];
  /** The epics could not be read: the epic tab offers to try again. */
  epicsFailed?: boolean;
  onRetryEpics?: () => void;
  /** Draws the epic label of the epic tab's heading; with `onOpenEpic`, the heading shows. */
  renderEpicLabel?: (epic: EpicRef) => ReactNode;
  /** Opens the epic's preview dialog (PC only). */
  onOpenEpic?: (epicId: string) => void;
  statusLabels?: 'pc' | 'monitor';
  ownerName?: string;
  readOnlyDraft?: boolean;
  /** Lets the person check and uncheck the conditions; without it they are read-only. */
  onToggleCondition?: (conditionId: string, done: boolean) => Promise<unknown>;
  toolbar?: ReactNode;
  /**
   * Lays the tabs' pages side by side and slides them with a finger or a pen, as the phone's task
   * drawer does (the PC board on a tablet). A mouse still selects text.
   */
  swipeTabs?: boolean;
  children?: ReactNode;
}

/** A press of a mouse: it selects text and drags nothing. */
function isMouse(event: Event): boolean {
  return event.type.startsWith('mouse') || (event as PointerEvent).pointerType === 'mouse';
}

/** Side-effect-free shared card display. Optional children are PC-only operations supplied by its host. */
export function TaskDetailView({
  projectId,
  task,
  document,
  history,
  epicDocument,
  onRetryDocument,
  onRetryHistory,
  onRetryEpicDocument,
  tab,
  onTabChange,
  onClose,
  attachmentUrl = (id) => `/api/projects/${projectId}/tasks/${task.id}/attachments/${id}`,
  problems = [],
  epics,
  epicsFailed = false,
  onRetryEpics,
  renderEpicLabel,
  onOpenEpic,
  statusLabels = 'pc',
  ownerName,
  readOnlyDraft = true,
  onToggleCondition,
  toolbar,
  swipeTabs = false,
  children,
}: TaskDetailViewProps) {
  const { t } = useTranslation();
  const idBase = useId();
  const carouselRef = useSwipePages(DETAIL_TABS, tab, onTabChange, {
    ignore: (target, root, event) =>
      isMouse(event) ||
      Boolean(window.getSelection()?.toString()) ||
      shouldIgnoreTabSwipe(target, root),
  });
  // The active panel scrolls the document; a long one is drawn only near the viewport.
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const panelRef = (id: DetailTab) => (tab === id ? setScroller : undefined);
  const ownProblems = problems.filter((problem) =>
    problem.file.startsWith(`projects/${projectId}/tasks/${task.id}/`),
  );
  // The card's epic is looked up in the project's epics; a card without one has no epic tab content.
  const epic: EpicRef | null = task.epic
    ? (epics?.find((item) => item.id === task.epic?.id) ?? null)
    : null;
  const epicStatus: EpicTabStatus = !task.epic
    ? 'none'
    : epic
      ? 'ready'
      : epics === undefined && !epicsFailed
        ? 'loading'
        : 'failed';
  const content = (id: DetailTab): ReactNode => {
    switch (id) {
      case 'description':
        return (
          <BodyDocumentView
            document={document}
            onRetry={() => onRetryDocument?.()}
            acceptanceError={task.acceptanceError ?? false}
            problems={ownProblems}
            projectId={projectId}
            taskId={task.id}
            attachmentUrl={attachmentUrl}
            scrollParent={tab === id ? scroller : null}
          />
        );
      case 'epic':
        return (
          <EpicTabView
            projectId={projectId}
            epic={epic}
            status={epicStatus}
            document={epicDocument}
            onRetry={onRetryEpics}
            onRetryDocument={onRetryEpicDocument}
            scrollParent={tab === id ? scroller : null}
            renderEpicLabel={renderEpicLabel}
            onOpenEpic={onOpenEpic}
          />
        );
      case 'history':
        return (
          <DetailSectionView snapshot={history} onRetry={() => onRetryHistory?.()}>
            {(data) => <HistoryTimeline events={data.items} resolveAttachment={attachmentUrl} />}
          </DetailSectionView>
        );
      case 'acceptance':
        return (
          <DetailSectionView snapshot={document} onRetry={() => onRetryDocument?.()}>
            {(data) => (
              <AcceptanceTabView
                task={{
                  acceptance: data.acceptance,
                  acceptanceError: task.acceptanceError ?? false,
                }}
                onToggle={onToggleCondition}
                resolveAttachment={attachmentUrl}
              />
            )}
          </DetailSectionView>
        );
    }
  };
  return (
    <aside className="detail detail-view" aria-label={t('detail.title')}>
      <DetailHeader
        identity={
          <>
            {ownerName && <span className="detail__owner">{ownerName} · </span>}#{task.id}
          </>
        }
        toolbar={toolbar}
        onClose={onClose}
      />
      <h2 className="detail__title" id="card-detail-title">
        {task.title}
      </h2>
      <div className="detail__meta">
        <StatusLabel kind="card" status={task.taskStatus} monitor={statusLabels === 'monitor'} />
        {stateLabel(task) !== null && (
          <StatusLabel
            kind="agent"
            status={task.agentStatus}
            monitor={statusLabels === 'monitor'}
          />
        )}
        <AssigneeLabel assignee={task.assignee} />
        <span className="detail__assignee" aria-hidden="true">
          {t(`assignee.${task.assignee}`)}
        </span>
      </div>
      {readOnlyDraft && task.draft !== null && <DraftStatus />}
      {children}
      <DetailTabs
        idBase={idBase}
        tab={tab}
        historyCount={(history.data ?? history.partial)?.items.length}
        onChange={onTabChange}
      />
      {swipeTabs ? (
        <div className="detail__pages" ref={carouselRef}>
          <div className="detail__track">
            {DETAIL_TABS.map((id) => (
              <div
                key={id}
                className="detail__viewport detail__page"
                role="tabpanel"
                id={panelId(idBase, id)}
                aria-labelledby={tabId(idBase, id)}
                aria-hidden={tab !== id}
                inert={tab !== id}
                ref={panelRef(id)}
              >
                {/* The neighbours are drawn too, so a swipe shows them while it moves. */}
                {Math.abs(DETAIL_TABS.indexOf(id) - DETAIL_TABS.indexOf(tab)) <= 1 && content(id)}
              </div>
            ))}
          </div>
        </div>
      ) : (
        DETAIL_TABS.map((id) => (
          <div
            key={id}
            className="detail__viewport"
            role="tabpanel"
            id={panelId(idBase, id)}
            aria-labelledby={tabId(idBase, id)}
            hidden={tab !== id}
            ref={panelRef(id)}
          >
            {tab === id && content(id)}
          </div>
        ))
      )}
    </aside>
  );
}
