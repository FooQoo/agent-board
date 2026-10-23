import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { stateLabel } from '../model/format';
import type { EpicRef, Problem, ProjectId, TaskSummary } from '../../../shared/api/contracts';
import type { SectionSnapshot } from '../../../shared/data/core';
import { AssigneeLabel } from '../assignee/AssigneeLabel';
import { HistoryTimeline } from '../history/HistoryTimeline';
import { StatusLabel } from '../status/StatusLabel';
import { BodyDocumentView } from './BodyDocumentView';
import { type DetailTab, DetailTabs, panelId, tabId } from './DetailTabs';
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
  statusLabels?: 'pc' | 'monitor';
  ownerName?: string;
  readOnlyDraft?: boolean;
  toolbar?: ReactNode;
  children?: ReactNode;
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
  statusLabels = 'pc',
  ownerName,
  readOnlyDraft = true,
  toolbar,
  children,
}: TaskDetailViewProps) {
  const { t } = useTranslation();
  const idBase = useId();
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
      {readOnlyDraft && task.isDraft && <DraftStatus />}
      {children}
      <DetailTabs
        idBase={idBase}
        tab={tab}
        historyCount={(history.data ?? history.partial)?.items.length}
        onChange={onTabChange}
      />
      <div
        className="detail__viewport"
        role="tabpanel"
        id={panelId(idBase, 'description')}
        aria-labelledby={tabId(idBase, 'description')}
        hidden={tab !== 'description'}
        ref={panelRef('description')}
      >
        {tab === 'description' && (
          <BodyDocumentView
            document={document}
            onRetry={() => onRetryDocument?.()}
            acceptanceError={task.acceptanceError ?? false}
            problems={ownProblems}
            projectId={projectId}
            taskId={task.id}
            attachmentUrl={attachmentUrl}
            scrollParent={scroller}
          />
        )}
      </div>
      <div
        className="detail__viewport"
        role="tabpanel"
        id={panelId(idBase, 'epic')}
        aria-labelledby={tabId(idBase, 'epic')}
        hidden={tab !== 'epic'}
        ref={panelRef('epic')}
      >
        {tab === 'epic' && (
          <EpicTabView
            projectId={projectId}
            epic={epic}
            status={epicStatus}
            document={epicDocument}
            onRetry={onRetryEpics}
            onRetryDocument={onRetryEpicDocument}
            scrollParent={scroller}
          />
        )}
      </div>
      <div
        className="detail__viewport"
        role="tabpanel"
        id={panelId(idBase, 'history')}
        aria-labelledby={tabId(idBase, 'history')}
        hidden={tab !== 'history'}
        ref={panelRef('history')}
      >
        {tab === 'history' && (
          <DetailSectionView snapshot={history} onRetry={() => onRetryHistory?.()}>
            {(data) => <HistoryTimeline events={data.items} />}
          </DetailSectionView>
        )}
      </div>
      <div
        className="detail__viewport"
        role="tabpanel"
        id={panelId(idBase, 'acceptance')}
        aria-labelledby={tabId(idBase, 'acceptance')}
        hidden={tab !== 'acceptance'}
        ref={panelRef('acceptance')}
      >
        {tab === 'acceptance' && (
          <DetailSectionView snapshot={document} onRetry={() => onRetryDocument?.()}>
            {(data) => (
              <AcceptanceTabView
                task={{
                  acceptance: data.acceptance,
                  acceptanceError: task.acceptanceError ?? false,
                }}
              />
            )}
          </DetailSectionView>
        )}
      </div>
    </aside>
  );
}
